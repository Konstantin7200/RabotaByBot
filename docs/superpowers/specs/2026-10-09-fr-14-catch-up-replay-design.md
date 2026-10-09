# FR-14 Catch-Up Replay (Дозаработка) — Design

**Date:** 2026-10-09
**Branch:** `backend/feature/fr14CatchUpReplay`
**Requirements:** `Technical assignment (RU).md` §3 FR-14 (also FR-3 basis rule, FR-7/FR-11 failed-replay boundary); `User stories (RU).md` US-11.

## 1 · Goal and outcome

After any period during which a linked mailbox missed mail (server downtime, lost
push, expired watch, exhausted delivery retries), every relevant Rabota.by reply
from that period is delivered exactly once:

- **US-11.1** — all missed relevant replies from an unavailable period (while the
  account was linked) are delivered after recovery;
- **US-11.2** — catch-up never duplicates already-delivered notifications.

The mechanism is a single catch-up core (`history.list` from the stored basis,
`messages.list` fallback on 404) driven by three triggers: recovery after
failure, accumulated `failed` deliveries, and a daily reconciliation pass.

## 2 · Current state (what exists, what is missing)

| Piece | State |
|---|---|
| `messages` history scan with `nextPageToken` exhaustion | exists — `src/gmail/getMessageIds.ts` |
| Journal with `pending → sent \| failed` + dedup on `(mailboxId, gmailMessageId)` | exists — `src/db/notificationRepository.ts` |
| Basis storage `mailboxes.historyIdBasis` | exists, **write-only today** — written by `advanceBasis` / `setWatchSuccess`, never read (FR-14 is its only consumer) |
| `replayFailed()` | exists, **unwired** — FR-11 explicitly left it to FR-14 |
| `mailboxes.lastDeliveredAt` + `setLastDeliveredAt()` | exist, **never written** |
| `cleanupOlderThan()` | exists, unwired (stays out of scope) |
| Downtime detection | exists — `announceRestart.ts` (heartbeat gap) |
| Daily cron infrastructure | exists — croner jobs in `src/scheduler/index.ts` |
| Catch-up job, 404 fallback, trigger wiring | **missing — this design** |

## 3 · Data model change

One new column (drizzle migration generated via `npm run db:generate`):

```ts
// src/db/schema.ts — mailboxesTable
historyIdBasisAt: timestamp({ withTimezone: true }),
```

Semantics: the wall-clock time at which `historyIdBasis` was last written.

Write rules (mirror the basis exactly):

- `advanceBasis(id, historyIdBasis)` → sets `historyIdBasisAt = now` together with
  the basis (the "only after inserts are durable" comment applies to both);
- `setWatchSuccess(email, historyIdBasis, expiration)` → COALESCE for
  `historyIdBasisAt` just like the basis (set only when basis was null);
- `unlinkMailbox()` → clears `historyIdBasisAt` alongside `historyIdBasis`;
- Legacy rows (basis set, `historyIdBasisAt IS NULL`): bound falls back to
  epoch (see §4.3) — no backfill migration.

`lastDeliveredAt` is wired on successful delivery (`deliverNotification` → after
`setNotificationDelivered`) because §2 of the spec lists it as stored metadata.
It is **not** used as a fallback scan bound (rationale in §4.3).

## 4 · Catch-up core — `src/gmail/catchUpMailbox.ts`

### 4.1 Signature and skip rules

```ts
type CatchUpResult =
  | { outcome: "skipped"; reason: "not_active" | "no_token" | "no_basis" }
  | { outcome: "ok"; source: "history" | "messages_fallback";
      scanned: number; inserted: number; delivered: number };

catchUpMailbox(mailbox: MailboxesTable): Promise<CatchUpResult>
```

Skip (never an error):

1. `accessStatus !== "active"` → `not_active`;
2. `refreshToken === null` → `no_token`;
3. `historyIdBasis === null` → `no_basis` — **FR-3/FR-9 rule**: a reset basis
   (fresh link or re-link after unlink) means "basis comes from the watch
   response, no retrospective catch-up".

### 4.2 Primary path (history)

Identical to the push path's processing, starting from the **stored** basis:

1. `getMessageIds(gmail, email, mailbox.historyIdBasis)` — paginated, throws if
   no `historyId` comes back;
2. `getDataFromMessages(...)` — existing From-domain validation (FR-5) and
   field parsing (FR-6);
3. `addNotifications(...)` — `onConflictDoNothing` = FR-7 dedup;
4. `listByMessageIds(...)` → **`advanceBasis(newHistoryId)` only after the
   inserts are durable** (existing invariant, `mailboxRepository.ts:73`);
5. `deliverBatchUntilTerminal(rows)` — same inline delivery + budget as the
   push path;
6. return counts.

On any thrown error: basis untouched; the error is handled per §4.4 (inside
the core) and rethrown for the trigger to log.

### 4.3 Fallback path (`history.list` → 404)

`isHistoryUnavailable(err): boolean` — new helper in
`src/gmail/classifyAccessError.ts` reusing its status extraction: HTTP **404**
only. 404 means the stored `historyId` is no longer valid (long idle); it is
**not** an access failure and never triggers `setAccessFailure`.

`listMessageIdsSince(gmail, email, afterUnixSeconds): Promise<string[]>` — new
`src/gmail/listMessageIdsSince.ts`:

- `users.messages.list` with `q: "from:rabota.by after:<sec>"` (the domain
  constant already used by `isFromRabotaBy`);
- paginate on `nextPageToken` to exhaustion (same repeated-token guard style as
  `getMessageIds`);
- `includeSpamTrash: true` — recall-first: a reply that landed in spam must not
  be lost; candidates are re-validated against the real RFC 5322 From header by
  the existing `validateMessages` inside `getDataFromMessages`.

**Scan bound (`after`)** = `historyIdBasisAt ?? new Date(0)` (epoch), in Unix
seconds minus 1 (one-second overlap; the journal absorbs the overlap).

Rationale — why the basis timestamp and not the spec's literal
"дата от последнего доставленного письма, но не раньше текущего базиса":

- everything **at or before** the basis is journaled (batches are inserted
  before the basis advances), so a bound equal to the basis can neither miss
  unprocessed mail nor re-deliver journaled mail;
- `lastDeliveredAt` can be **later** than the basis — delivery with backoff may
  complete after a newer push advanced the basis. If that push was silently
  lost, a `lastDeliveredAt`-based bound starts *after* the unprocessed mail and
  skips it permanently (violates US-11.1). The basis bound is therefore the
  safe, tighter interpretation of the requirement;
- with `historyIdBasisAt IS NULL` (legacy row) the bound degrades to epoch:
  `tokenGrantedAt` resets to `now` on every re-consent
  (`createMailbox` upsert, `mailboxRepository.ts`), so on a legacy row it can
  **postdate** the preserved basis — if that basis later 404s, a
  `tokenGrantedAt`-derived scan starts after the re-consent and permanently
  skips the mail in between (violates US-11.1). Epoch is therefore the only
  safe degradation; the wide scan it implies for a very old legacy row is
  accepted per §9's residual risk (sender-filtered, ≤100 users).

After a successful fallback scan: `getProfile` runs **after** the scan and
**before** the inserts — the full order is scan → `getProfile` → inserts →
`advanceBasis` → deliver — and the new basis comes from
`users.getProfile({ userId })` (`response.data.historyId`) because
`messages.list` carries no history id. Mail arriving in between is
covered by its own push (pushes start from the Pub/Sub payload's
`historyId`, not from our stored basis).

### 4.4 Error handling inside the core

- `404` from `history.list` → §4.3 fallback (not classified as access loss);
- every other error is classified **inside `catchUpMailbox`** (one place, shared
  by all three triggers, mirroring the push path): `classifyAccessError` →
  `transient` = log only; `expired`/`error` = `setAccessFailure` +
  `notifyMailboxOwner` with the existing `MESSAGE_*` constants;
- after handling, the error is rethrown; **the basis is never advanced on the
  error path**. Triggers only log (`catch_up_failed` / `job_error`) and move on
  — the next pass retries.

## 5 · Triggers

### 5.1 Recovery — server restart

`announceRestart(): Promise<boolean>` returns whether a downtime gap was found
(computed today for the "back online" broadcast). `src/index.ts` awaits it and,
when `true`, runs `runCatchUpPass()` after announcing. Catch-up failure at
startup is logged, never fatal to boot.

### 5.2 Recovery — re-login with preserved basis (FR-3)

`src/auth/callback.ts`, after `watch()` and after the browser/Telegram
responses are sent: fire-and-forget

```ts
if (existing !== null && existing.historyIdBasis !== null)
    void getMailbox(email)
        .then((m) => (m === null ? undefined : catchUpMailbox(m)))
        .catch((err) => console.log({ event: "catch_up_failed", email, err: String(err) }));
```

(The row is re-read after `createMailbox`/`watch` so the core sees the
preserved basis and the fresh watch expiration.)

- only when a basis was **preserved** (recovery after failure); a first link or
  a re-link after unlink has `historyIdBasis === null` → the core skips it anyway;
- FR-3's "сначала выполняется дозаработка" holds structurally: `watch()` writes
  the basis with COALESCE (it never jumps forward), so the replay starts from
  the preserved basis and is what advances it — without blocking the OAuth
  response (approved decision: async after response).

### 5.3 Accumulated `failed` + daily reconciliation — one job

New `src/scheduler/jobs/catchUpPass.ts`:

```ts
runCatchUpPass(): Promise<void>   // mutex-guarded like runDeliveryPass
```

Order of work:

1. **`replayFailed()`** — `failed → pending`, `attempts = 0`,
   `nextAttemptAt = now`; the existing 10-second delivery pass then retries
   them. FR-7/FR-11 assign this replay to FR-14's reconciliation pass, so it
   lives here rather than in a separate cron; a separate, more frequent replay
   would defeat FR-11's attempt limit. Worst-case wait for a `failed` row:
   ≤ 24 h.
2. For every mailbox from `listActive()` (fresh rows): `catchUpMailbox(...)`
   inside a per-mailbox try/catch — one broken mailbox (dead token, quota)
   must not abort the rest; access-loss classification per §4.4 applies per
   mailbox.
3. Structured log summary:
   `{ event: "catch_up_pass", replayed, mailboxes, ok, skipped, failed }` plus a
   per-mailbox `{ event: "catch_up_mailbox", email, outcome, source?, scanned?,
   inserted?, delivered? }`.

Wiring in `src/scheduler/index.ts`, same pattern as the other jobs:

- `CATCHUP_TICK = "0 3 * * *"` (daily at 03:00, server time) in
  `src/constants.ts`;
- `protect` → `job_skipped_overlap`, `catch` → `job_error`, one
  `scheduler_started` log, `trigger()` at startup alongside the others.

The daily pass is the trigger that compensates silently lost pushes
(risk table: «Push не приходит, но сроки watch/токена в норме») and the
7-day watch-expiry gap.

## 6 · Concurrency

No per-mailbox lock — interleaving push and catch-up is safe without one:

- **Inserts:** both paths use `onConflictDoNothing` on the FR-7 key;
- **Basis:** every interleaving is safe because (a) insert-before-advance
  guarantees everything ≤ basis is journaled, (b) a basis written by a late
  catch-up can only be ≤ what its own scan covered (mail in the covered range is
  journaled), (c) a *regressed* basis merely widens the next scan, which the
  journal absorbs as dedup — never a loss, never a duplicate;
- **Delivery:** single-process funnel — all delivery goes through the mutexed
  `runDeliveryPass` (module-level `inFlight` promise), so two concurrent
  waiters (`deliverBatchUntilTerminal`) cannot double-send a row;
- deployment is single-instance (NFR «Доступность»), so an in-process mutex is
  the whole story.

## 7 · Testing strategy (TDD, vitest)

New/extended test files, following the repo convention (no test imports
`src/config.ts` / `src/index.ts`; wiring in routes/scheduler/index is
typecheck-only):

| Area | Cases |
|---|---|
| `catchUpMailbox.test.ts` (new) | skips: inactive, no token, null basis; history path: scan → insert → **advanceBasis after inserts** → deliver; `advanceBasis` **not** called when scan/insert throws; 404 → fallback path used, basis advanced from `getProfile`; fallback skipped/no-op when basis null; access error classification (transient logs, non-transient marks + notifies) |
| `listMessageIdsSince.test.ts` (new) | query shape (`from:rabota.by after:<basisAt−1s>`, `includeSpamTrash`); pagination to exhaustion; repeated-token guard |
| `catchUpPass.test.ts` (new) | `replayFailed` runs **before** per-mailbox scans; iterates active mailboxes only; one mailbox rejecting does not stop the others; mutex re-arm (second call after a rejected pass starts fresh) |
| repository write changes (`advanceBasis`, `setWatchSuccess`, `unlinkMailbox`, `setNotificationDelivered`) | **no test precedent** — this repo never tests drizzle repository internals (tests mock at the repository boundary, see `src/scheduler/jobs/*.test.ts`). Covered by `typecheck` (the new column is schema-typed) and by the §4.3 fallback-bound test asserting the value the core passes |
| `announceRestart.test.ts` (extend) | returns `true` on downtime gap, `false` when heartbeat fresh |

Gates: `npm test`, `npm run lint`, `npm run typecheck` green; migration file
generated and committed.

## 8 · Explicit non-goals

- **`/status` surfacing** of catch-up state — FR-1 does not require it;
- **journal cleanup** — `cleanupOlderThan` stays unwired; unbounded retention
  trivially satisfies FR-7's "≥ catch-up window", and the §4.3 bound keeps the
  scan window at "after the basis" anyway;
- **push-path changes** — `notificationHandler` behavior, ack semantics
  (200/503), and OIDC auth are untouched;
- **a separate replay cron** for `failed` rows (see §5.3);
- **backfilling `historyIdBasisAt`** for legacy rows (safe fallback in §4.3).

## 9 · Residual risks

| Risk | Handling |
|---|---|
| `messages.list` `after:` uses second granularity → boundary second re-scanned | 1-second overlap; journal dedup absorbs it (US-11.2) |
| `getProfile` basis jump races a concurrent push | push writes its own `newHistoryId` afterwards or before; both orders safe per §6 |
| Daily pass overlaps a long-running previous pass | `protect` on the cron + in-job mutex → skip + `job_skipped_overlap` log |
| Fallback scans a wide window for a very old legacy row (null `historyIdBasisAt`) | bounded by `from:rabota.by` sender filter; volumes tiny at ≤100 users; quota NFR has ~10k ops/user/day headroom |
| Catch-up runs while mailbox is mid-relink (basis cleared under it) | rows already inserted stay (FR-7 keeps them across unlink); basis write of the in-flight scan uses a fresh row read only at trigger time — an eventual consistency edge accepted at single-instance scale, dedup keeps it duplicate-free |
