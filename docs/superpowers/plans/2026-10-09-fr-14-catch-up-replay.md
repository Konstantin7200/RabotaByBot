# FR-14 Catch-Up Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Missed Rabota.by replies are caught up after any downtime via a shared `catchUpMailbox` core driven by three triggers (restart-after-downtime, re-login with preserved basis, daily reconciliation pass), with `failed` journal rows replayed by the same pass (FR-14, US-11).

**Architecture:** One core in `src/gmail/catchUpMailbox.ts`: skip inactive/token-less/basis-less mailboxes, scan `history.list` from the stored basis (existing paginated `getMessageIds`), fall back to a sender+date-filtered `messages.list` on history-404 (basis then advanced from `getProfile`), insert journal rows (`onConflictDoNothing` = FR-7 dedup) **before** advancing the basis, then deliver through the existing mutexed delivery pass. Triggers are thin: `announceRestart()` gains a downtime boolean consumed by `src/index.ts`, the OAuth callback fires the core after responding (only when a basis was preserved), and a new daily croner job `runCatchUpPass()` replays `failed` rows first, then scans every active mailbox.

**Tech Stack:** Node.js ≥20, TypeScript, Express, grammY, PostgreSQL + Drizzle (one new column + migration), croner, vitest. No new dependencies, no new env vars.

**Spec:** `docs/superpowers/specs/2026-10-09-fr-14-catch-up-replay-design.md` (repo root requirement source: `Technical assignment (RU).md` §3 FR-14, FR-3 basis rule, FR-7/FR-11 replay boundary; US-11).

## Global Constraints

- **Basis invariant:** `advanceBasis` runs only after the batch's journal inserts are durable — never on any error path (`spec §4.2/§4.4`, `src/db/mailboxRepository.ts:73` comment). Dedup key stays `(mailboxId, gmailMessageId)` via `onConflictDoNothing`.
- **404 means stale history id, not access loss:** HTTP 404 from `history.list` triggers the fallback only; it must never call `setAccessFailure` or notify the user. 404 from any *other* call (e.g. `messages.get` on a deleted message) is an ordinary error (`spec §4.3/§4.4`).
- **Fallback scan bound:** `after = max(0, floor((historyIdBasisAt ?? tokenGrantedAt ?? epoch).getTime() / 1000) - 1)` — never `lastDeliveredAt` (spec §4.3 rationale: it can skip permanently lost mail).
- **Delivery single-funnel:** all sending goes through the mutexed `runDeliveryPass` via `deliverBatchUntilTerminal`; never call `deliverNotification` directly from new code (prevents double sends under concurrent push + catch-up).
- **Skip rules (spec §4.1):** `not_active` when `accessStatus !== "active"`, `no_token` when `refreshToken === null`, `no_basis` when `historyIdBasis === null` (FR-3/FR-9: no basis ⇒ no retrospective replay).
- **Style:** bot copy English, `MESSAGE_*` constants in `src/constants.ts`; structured logs via `console.log({ event: ... })`; CommonJS; Conventional Commits, one commit per task's final step.
- **Testing convention:** tests mock at the repository/module boundary and must not import `src/config.ts` or `src/index.ts` (wiring in `scheduler/index.ts`, `index.ts`, `auth/callback.ts` is typecheck-only).
- **Gates:** `npm test`, `npm run lint`, `npm run typecheck` — baseline **21 files / 111 tests green** before Task 1.
- **Migration:** generated with `npm run db:generate` (no DB connection needed); applying it (`npm run db:migrate`) is a deploy step, not a test step.

## Review Focus

1. **Basis advances past unfetched mail or on error** (silent loss, violates FR-3/FR-7) — expected: inserts strictly precede `advanceBasis`; no advance when scan, ingestion, or `getProfile` throws. Tests: Task 4 (order + four no-advance cases).
2. **Fallback `after` bound is wrong** (too late = skips unprocessed mail forever; wrong field = the `lastDeliveredAt` race from spec §4.3) — expected: `after = floor(basisAt/1000) − 1`, degrading to `tokenGrantedAt`, then `0`; query carries `from:rabota.by` + `includeSpamTrash`. Tests: Task 4 (exact argument, three bound cases) + Task 3 (query shape).
3. **404 treated as access failure** (user told to `/start`, fallback never runs) — expected: 404 from `history.list` → fallback path, `setAccessFailure`/`notifyMailboxOwner` untouched; 404 from `messages.get` → error classification, **no** fallback. Tests: Task 2 (classifier) + Task 4 (both paths).
4. **`failed` replay runs late or loops** (FR-11 says FR-14 replays it; a second replay would defeat the attempt limit) — expected: `replayFailed()` exactly once, before the first mailbox scan; no replay anywhere else. Tests: Task 5 (ordering via `invocationCallOrder`).
5. **One broken mailbox aborts the daily pass** (silent outage for every other user) — expected: a rejecting `catchUpMailbox` is logged and counted, the remaining mailboxes still scan. Test: Task 5 (isolation).

---

### Task 1: Repository layer — `historyIdBasisAt`, migration, journal count, `lastDeliveredAt`

**Files:**
- Modify: `src/db/schema.ts:34-46` (`mailboxesTable`)
- Create: `drizzle/0001_*.sql` (via `npm run db:generate`)
- Modify: `src/db/mailboxRepository.ts` (`advanceBasis`, `setWatchSuccess`, `unlinkMailbox`)
- Modify: `src/db/notificationRepository.ts:20-32` (`addNotifications` return value)
- Modify: `src/bot/deliverNotification.ts:29-30`
- Test: `src/bot/deliverNotification.test.ts`

**Interfaces:**
- Consumes: none.
- Produces:
  - `mailboxes.historyIdBasisAt: timestamp({ withTimezone: true })` — nullable; wall-clock time of the last basis write.
  - `advanceBasis(id: number, historyIdBasis: string): Promise<void>` — now also writes `historyIdBasisAt: new Date()`.
  - `setWatchSuccess(email, historyIdBasis, watchExpiration)` — COALESCEs `historyIdBasisAt` exactly like `historyIdBasis`.
  - `unlinkMailbox(userId)` — clears `historyIdBasisAt` alongside `historyIdBasis`.
  - `addNotifications(values): Promise<number>` — count of newly inserted rows (was `InsertedNotification | null`; sole caller `notificationHandler.ts:61` ignores the value).
  - `setLastDeliveredAt(id, date)` called from `deliverNotification` right after `setNotificationDelivered`.

- [ ] **Step 1: Write the failing test for `lastDeliveredAt` wiring**

In `src/bot/deliverNotification.test.ts`, add to the mock block:

```ts
vi.mock("../db/mailboxRepository", () => ({ setLastDeliveredAt: vi.fn() }));
```

and import `setLastDeliveredAt` from `../db/mailboxRepository`. In the first test (`"sends, then fixes sent, then marks chat ok — in that order"`), append:

```ts
expect(setLastDeliveredAt).toHaveBeenCalledWith(3, expect.any(Date));
expect(vi.mocked(setNotificationDelivered).mock.invocationCallOrder[0])
    .toBeLessThan(vi.mocked(setLastDeliveredAt).mock.invocationCallOrder[0]);
```

(row fixture's `mailboxId` is `3`; delivery must be fixed before the mailbox timestamp.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/bot/deliverNotification.test.ts`
Expected: FAIL — `setLastDeliveredAt` not called (and mock exports an unused function).

- [ ] **Step 3: Add the `historyIdBasisAt` column and generate the migration**

In `src/db/schema.ts` `mailboxesTable`, after `historyIdBasis`:

```ts
historyIdBasisAt: timestamp({ withTimezone: true }),
```

Run: `npm run db:generate`
Expected: a new file `drizzle/0001_*.sql` containing `ALTER TABLE "mailboxes" ADD COLUMN "historyIdBasisAt" timestamp with time zone;`

- [ ] **Step 4: Write the basis-timestamp repository changes**

- `advanceBasis`: `set({ historyIdBasis, historyIdBasisAt: new Date() })` — both fields written together; extend the existing durability comment to cover `historyIdBasisAt`.
- `setWatchSuccess`: keep the basis COALESCE as is; pair the timestamp with the *basis fill*, not with "now":

```ts
historyIdBasisAt: sql`COALESCE(${mailboxesTable.historyIdBasisAt}, CASE WHEN ${mailboxesTable.historyIdBasis} IS NULL THEN CURRENT_TIMESTAMP ELSE NULL END)`,
```

Why the CASE (do not simplify to `COALESCE(historyIdBasisAt, now())`): `SET` expressions read the **old** row values, so `historyIdBasis IS NULL` means "this call is the one filling the basis" ⇒ stamp now. For a legacy row (basis set, `historyIdBasisAt` null — every production row when this migration lands) the CASE yields `NULL`, the timestamp stays null, and the fallback bound safely degrades to `tokenGrantedAt` (spec §4.3). A naive `now()` backfill would stamp a time *after* the real basis and could close the replay window over unprocessed mail — the exact loss the bound exists to prevent.

- `unlinkMailbox`: add `historyIdBasisAt: null` to `updateValue`.

- [ ] **Step 5: Change `addNotifications` to return the inserted count**

Replace the final `return rows.length > 0 ? rows[0] : null;` in `addNotifications` with `return rows.length;` and type the function `Promise<number>`. Do not touch singular `addNotification`. (`notificationHandler.ts` ignores the value — typecheck will confirm no other caller.)

- [ ] **Step 6: Wire `setLastDeliveredAt` in `deliverNotification`**

After `await setNotificationDelivered(...)` (line 29), before `setChatStatus`:

```ts
await setLastDeliveredAt(notification.mailboxId, new Date());
```

- [ ] **Step 7: Run tests, typecheck, lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green (21 files / 111 tests — the deliverNotification test now asserts the new call).

- [ ] **Step 8: Commit**

```bash
git add src/db/schema.ts drizzle/ src/db/mailboxRepository.ts src/db/notificationRepository.ts src/bot/deliverNotification.ts src/bot/deliverNotification.test.ts
git commit -m "feat: track basis timestamp and last delivery time"
```

---

### Task 2: `isHistoryUnavailable` classifier helper

**Files:**
- Modify: `src/gmail/classifyAccessError.ts`
- Test: `src/gmail/classifyAccessError.test.ts`

**Interfaces:**
- Consumes: the private `getStatusCode(err)` already in `classifyAccessError.ts:11`.
- Produces: `isHistoryUnavailable(err: unknown): boolean` — `true` only when `getStatusCode(err) === 404`.

- [ ] **Step 1: Write the failing tests**

Append to `src/gmail/classifyAccessError.test.ts` (the file already has a local `gaxiosError` helper):

```ts
import { classifyAccessError, isHistoryUnavailable } from "./classifyAccessError";

describe("isHistoryUnavailable", () => {
    it("is true for a 404 from either code or response status", () => {
        expect(isHistoryUnavailable(gaxiosError({ code: 404 }))).toBe(true);
        expect(isHistoryUnavailable(gaxiosError({ responseStatus: 404 }))).toBe(true);
    });
    it("is false for anything else", () => {
        expect(isHistoryUnavailable(gaxiosError({ code: 403 }))).toBe(false);
        expect(isHistoryUnavailable(gaxiosError({ responseStatus: 500 }))).toBe(false);
        expect(isHistoryUnavailable(gaxiosError({ code: "ETIMEDOUT" }))).toBe(false);
        expect(isHistoryUnavailable(new Error("invalid_grant"))).toBe(false);
        expect(isHistoryUnavailable(undefined)).toBe(false);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/gmail/classifyAccessError.test.ts`
Expected: FAIL — `isHistoryUnavailable` is not exported.

- [ ] **Step 3: Implement `isHistoryUnavailable`**

Add to `src/gmail/classifyAccessError.ts`:

```ts
export function isHistoryUnavailable(err: unknown): boolean {
    return getStatusCode(err) === 404;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/gmail/classifyAccessError.test.ts`
Expected: PASS (all existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/gmail/classifyAccessError.ts src/gmail/classifyAccessError.test.ts
git commit -m "feat: detect stale history id (404) separately from access errors"
```

---

### Task 3: `listMessageIdsSince` fallback scan

**Files:**
- Create: `src/gmail/listMessageIdsSince.ts`
- Test: `src/gmail/listMessageIdsSince.test.ts`

**Interfaces:**
- Consumes: `gmail_v1.Gmail` client (same as `getMessageIds.ts`).
- Produces: `listMessageIdsSince(gmail: gmail_v1.Gmail, email: string, afterUnixSeconds: number): Promise<string[]>` — all message ids matching `from:rabota.by after:<afterUnixSeconds>`, pages followed to exhaustion, repeated `nextPageToken` rejected.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it, vi } from "vitest";
import { listMessageIdsSince } from "./listMessageIdsSince";

function makeGmail(pages: { messages?: { id: string }[]; nextPageToken?: string }[]) {
    const list = vi.fn()
        .mockImplementationOnce(async () => ({ data: pages[0] }))
        .mockImplementationOnce(async () => ({ data: pages[1] }));
    return { gmail: { users: { messages: { list } } } as never, list };
}

describe("listMessageIdsSince", () => {
    it("queries with the sender filter, the date bound, and spam included", async () => {
        const { gmail, list } = makeGmail([{ messages: [{ id: "m1" }] }]);
        await expect(listMessageIdsSince(gmail, "a@b.c", 1791446399)).resolves.toEqual(["m1"]);
        expect(list).toHaveBeenCalledWith({
            userId: "a@b.c",
            q: "from:rabota.by after:1791446399",
            includeSpamTrash: true,
            maxResults: 100,
            pageToken: undefined,
        });
    });

    it("follows nextPageToken to exhaustion", async () => {
        const { gmail, list } = makeGmail([
            { messages: [{ id: "m1" }], nextPageToken: "t1" },
            { messages: [{ id: "m2" }] },
        ]);
        await expect(listMessageIdsSince(gmail, "a@b.c", 1)).resolves.toEqual(["m1", "m2"]);
        expect(list).toHaveBeenCalledTimes(2);
        expect(list.mock.calls[1][0]).toMatchObject({ pageToken: "t1" });
    });

    it("deduplicates ids repeated across pages", async () => {
        const { gmail } = makeGmail([
            { messages: [{ id: "m1" }], nextPageToken: "t1" },
            { messages: [{ id: "m1" }] },
        ]);
        await expect(listMessageIdsSince(gmail, "a@b.c", 1)).resolves.toEqual(["m1"]);
    });

    it("throws when a page repeats its nextPageToken", async () => {
        const { gmail } = makeGmail([
            { messages: [{ id: "m1" }], nextPageToken: "t1" },
            { messages: [{ id: "m2" }], nextPageToken: "t1" },
        ]);
        await expect(listMessageIdsSince(gmail, "a@b.c", 1)).rejects.toThrow("Repeated messages page token");
    });

    it("returns an empty list when nothing matches", async () => {
        const { gmail } = makeGmail([{ messages: [] }]);
        await expect(listMessageIdsSince(gmail, "a@b.c", 1)).resolves.toEqual([]);
    });
});
```

(The single-page `makeGmail` only ever resolves the first `mockImplementationOnce`; single-page cases pass `pages` of length 1.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/gmail/listMessageIdsSince.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `listMessageIdsSince`**

Structure it like `getMessageIds.ts` (do/while over `nextPageToken`, `Set` of seen tokens, `Set` of ids): one `gmail.users.messages.list` call per page with exactly `{ userId: email, q: \`from:rabota.by after:${afterUnixSeconds}\`, includeSpamTrash: true, maxResults: 100, pageToken }`. Return `Array.from(idSet)`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/gmail/listMessageIdsSince.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/gmail/listMessageIdsSince.ts src/gmail/listMessageIdsSince.test.ts
git commit -m "feat: add sender-and-date messages.list fallback scan"
```

---

### Task 4: `catchUpMailbox` core

**Files:**
- Create: `src/gmail/catchUpMailbox.ts`
- Test: `src/gmail/catchUpMailbox.test.ts`

**Interfaces:**
- Consumes (all mocked in the test): `getMessageIds(gmail, email, startId)`, `listMessageIdsSince(gmail, email, after)` (Task 3), `getDataFromMessages(gmail, ids, email)`, `getUserGmailClient(refreshToken)`, `addNotifications(values): Promise<number>` (Task 1), `listByMessageIds(mailboxId, ids)`, `advanceBasis(id, historyId)` (Task 1), `setAccessFailure(email, status)`, `deliverBatchUntilTerminal(ids): Promise<"terminal" | "budget_exceeded">`, `notifyMailboxOwner(mailboxId, text)`, `isHistoryUnavailable(err)` (Task 2), `classifyAccessError(err)`.
- Produces:

```ts
export type CatchUpSkipReason = "not_active" | "no_token" | "no_basis";
export type CatchUpResult =
    | { outcome: "skipped"; reason: CatchUpSkipReason }
    | { outcome: "ok"; source: "history" | "messages_fallback";
        scanned: number; inserted: number; delivered: number };
export async function catchUpMailbox(mailbox: MailboxesTable): Promise<CatchUpResult>;
```

Semantics pinned by the spec: `scanned` = message ids fetched; `inserted` = rows this call actually inserted (from `addNotifications`'s new count, `0` when nothing was fetched); `delivered` = journal rows handed to `deliverBatchUntilTerminal` (`0` when none).

- [ ] **Step 1: Write the failing test skeleton with skip-rule cases**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/notificationRepository", () => ({ addNotifications: vi.fn(), listByMessageIds: vi.fn() }));
vi.mock("../db/mailboxRepository", () => ({ advanceBasis: vi.fn(), setAccessFailure: vi.fn() }));
vi.mock("./getMessages", () => ({ getDataFromMessages: vi.fn() }));
vi.mock("./getMessageIds", () => ({ getMessageIds: vi.fn() }));
vi.mock("./listMessageIdsSince", () => ({ listMessageIdsSince: vi.fn() }));
vi.mock("../bot/deliverBatch", () => ({ deliverBatchUntilTerminal: vi.fn() }));
vi.mock("./getUserGmailClient", () => ({ getUserGmailClient: vi.fn() }));
vi.mock("../bot/notifyMailboxOwner", () => ({ notifyMailboxOwner: vi.fn() }));

import { catchUpMailbox } from "./catchUpMailbox";
import { addNotifications, listByMessageIds } from "../db/notificationRepository";
import { advanceBasis, setAccessFailure } from "../db/mailboxRepository";
import { getDataFromMessages } from "./getMessages";
import { getMessageIds } from "./getMessageIds";
import { listMessageIdsSince } from "./listMessageIdsSince";
import { deliverBatchUntilTerminal } from "../bot/deliverBatch";
import { getUserGmailClient } from "./getUserGmailClient";
import { notifyMailboxOwner } from "../bot/notifyMailboxOwner";
import { MESSAGE_WATCH_EXPIRED, MESSAGE_MAIL_PROCESSING_ERROR } from "../constants";

const BASIS_AT = new Date("2026-10-09T00:00:00.000Z");
const GRANTED_AT = new Date("2026-10-01T00:00:00.000Z");
const mailbox = {
    id: 7, email: "a@b.c", refreshToken: "rt", accessStatus: "active",
    historyIdBasis: "100", historyIdBasisAt: BASIS_AT, tokenGrantedAt: GRANTED_AT,
} as never;
const gmail = { users: { getProfile: vi.fn() } } as never;
const messageData = (gmailMessageId: string) => ({
    gmailMessageId, subject: "S", vacancy: "Dev", employer: "ACME", outcome: "applied",
});
const notFound = Object.assign(new Error("not found"), { response: { status: 404 } });

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getUserGmailClient).mockReturnValue(gmail);
    vi.mocked(getMessageIds).mockResolvedValue({ messageIds: ["m1"], newHistoryId: "101" });
    vi.mocked(getDataFromMessages).mockResolvedValue([messageData("m1")]);
    vi.mocked(addNotifications).mockResolvedValue(1);
    vi.mocked(listByMessageIds).mockResolvedValue([{ id: 11 }] as never);
    vi.mocked(advanceBasis).mockResolvedValue(undefined);
    vi.mocked(setAccessFailure).mockResolvedValue(undefined as never);
    vi.mocked(notifyMailboxOwner).mockResolvedValue(undefined as never);
    vi.mocked(deliverBatchUntilTerminal).mockResolvedValue("terminal");
    vi.mocked(listMessageIdsSince).mockResolvedValue(["m1"]);
    vi.mocked(gmail.users.getProfile).mockResolvedValue({ data: { historyId: "200" } });
});

describe("catchUpMailbox — skip rules", () => {
    it.each([
        ["not_active", { accessStatus: "expired" }],
        ["no_token", { refreshToken: null }],
        ["no_basis", { historyIdBasis: null }],
    ])("skips with %s without touching Gmail", async (reason, patch) => {
        await expect(catchUpMailbox({ ...mailbox, ...patch } as never))
            .resolves.toEqual({ outcome: "skipped", reason });
        expect(getUserGmailClient).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run to verify the skeleton fails**

Run: `npx vitest run src/gmail/catchUpMailbox.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the skip rules and signature**

Create `src/gmail/catchUpMailbox.ts` with the exported types from the Interfaces block and the three skip checks in the spec's order (`not_active`, `no_token`, `no_basis`), then a `getUserGmailClient(mailbox.refreshToken)` call for the non-skipped path (stub the rest as `throw new Error("not implemented")` so the skeleton tests pass).

- [ ] **Step 4: Run to verify skip tests pass**

Run: `npx vitest run src/gmail/catchUpMailbox.test.ts`
Expected: PASS (3 parameterized tests).

- [ ] **Step 5: Add history-path tests (ingest order, empty batch, error paths)**

Append:

```ts
describe("catchUpMailbox — history path", () => {
    it("scans from the stored basis, inserts first, then advances, then delivers", async () => {
        const result = await catchUpMailbox(mailbox);
        expect(getMessageIds).toHaveBeenCalledWith(gmail, "a@b.c", "100");
        expect(result).toEqual({ outcome: "ok", source: "history", scanned: 1, inserted: 1, delivered: 1 });
        expect(vi.mocked(addNotifications).mock.invocationCallOrder[0])
            .toBeLessThan(vi.mocked(advanceBasis).mock.invocationCallOrder[0]);
        expect(advanceBasis).toHaveBeenCalledWith(7, "101");
        expect(listByMessageIds).toHaveBeenCalledWith(7, ["m1"]);
        expect(deliverBatchUntilTerminal).toHaveBeenCalledWith([11]);
    });

    it("advances the basis on an empty scan without inserting or delivering", async () => {
        vi.mocked(getMessageIds).mockResolvedValue({ messageIds: [], newHistoryId: "101" });
        await expect(catchUpMailbox(mailbox)).resolves
            .toEqual({ outcome: "ok", source: "history", scanned: 0, inserted: 0, delivered: 0 });
        expect(addNotifications).not.toHaveBeenCalled();
        expect(deliverBatchUntilTerminal).not.toHaveBeenCalled();
        expect(advanceBasis).toHaveBeenCalledWith(7, "101");
    });

    it("does not advance the basis when the scan throws", async () => {
        const err = Object.assign(new Error("boom"), { code: 503 });
        vi.mocked(getMessageIds).mockRejectedValue(err);
        await expect(catchUpMailbox(mailbox)).rejects.toThrow("boom");
        expect(advanceBasis).not.toHaveBeenCalled();
        expect(setAccessFailure).not.toHaveBeenCalled();   // transient
        expect(notifyMailboxOwner).not.toHaveBeenCalled();
    });

    it("does not advance the basis when ingestion throws", async () => {
        vi.mocked(getDataFromMessages).mockRejectedValue(Object.assign(new Error("forbidden"), { code: 403 }));
        await expect(catchUpMailbox(mailbox)).rejects.toThrow("forbidden");
        expect(advanceBasis).not.toHaveBeenCalled();
        expect(setAccessFailure).toHaveBeenCalledWith("a@b.c", "error");
        expect(notifyMailboxOwner).toHaveBeenCalledWith(7, MESSAGE_MAIL_PROCESSING_ERROR("a@b.c"));
    });

    it("marks expired and notifies on invalid_grant", async () => {
        vi.mocked(getMessageIds).mockRejectedValue(new Error("invalid_grant: revoked"));
        await expect(catchUpMailbox(mailbox)).rejects.toThrow("invalid_grant");
        expect(setAccessFailure).toHaveBeenCalledWith("a@b.c", "expired");
        expect(notifyMailboxOwner).toHaveBeenCalledWith(7, MESSAGE_WATCH_EXPIRED("a@b.c"));
        expect(advanceBasis).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 6: Run to verify they fail**

Run: `npx vitest run src/gmail/catchUpMailbox.test.ts`
Expected: FAIL — history path not implemented.

- [ ] **Step 7: Implement the history path**

Inside `catchUpMailbox`, after the skips:

1. `getMessageIds(gmail, email, mailbox.historyIdBasis)` inside its own `try/catch` — on `isHistoryUnavailable(err)` jump to Step 9's fallback; otherwise fall through to the shared error handler; on success continue;
2. shared `ingestAndDeliver(gmail, mailbox, messageIds, newHistoryId, source)` (private): `getDataFromMessages` → map to `AddNotificationType` rows (same mapping as `notificationHandler.ts:50-59`, `mailboxId: mailbox.id`) → `addNotifications` only when non-empty (result = its count, else `0`) → `listByMessageIds(mailbox.id, ids)` → `advanceBasis(mailbox.id, newHistoryId)` → `deliverBatchUntilTerminal(rows.map(r => r.id))` only when `rows.length > 0` (`delivered = rows.length`);
3. shared error handler (private `handleAccessError`): `classifyAccessError` → when `kind !== "transient"` and mailbox is `active`: `setAccessFailure` + `notifyMailboxOwner` (`expired` → `MESSAGE_WATCH_EXPIRED(email)`, else `MESSAGE_MAIL_PROCESSING_ERROR(email)`); always `console.log({ event: "catch_up_mailbox_failed", email, kind, err })`; rethrow the original error.

- [ ] **Step 8: Run to verify history tests pass**

Run: `npx vitest run src/gmail/catchUpMailbox.test.ts`
Expected: PASS (all so far).

- [ ] **Step 9: Add fallback tests (bound, 404 semantics)**

Append:

```ts
describe("catchUpMailbox — messages.list fallback on stale history id", () => {
    it("falls back on 404, scans from the basis timestamp, advances from getProfile", async () => {
        vi.mocked(getMessageIds).mockRejectedValue(notFound);
        const expectedAfter = Math.floor(BASIS_AT.getTime() / 1000) - 1;
        const result = await catchUpMailbox(mailbox);
        expect(listMessageIdsSince).toHaveBeenCalledWith(gmail, "a@b.c", expectedAfter);
        expect(gmail.users.getProfile).toHaveBeenCalledWith({ userId: "a@b.c" });
        expect(advanceBasis).toHaveBeenCalledWith(7, "200");
        expect(setAccessFailure).not.toHaveBeenCalled();
        expect(notifyMailboxOwner).not.toHaveBeenCalled();
        expect(result).toMatchObject({ outcome: "ok", source: "messages_fallback" });
    });

    it("falls back to the grant time when the basis timestamp is missing (legacy row)", async () => {
        vi.mocked(getMessageIds).mockRejectedValue(notFound);
        await catchUpMailbox({ ...mailbox, historyIdBasisAt: null } as never);
        expect(listMessageIdsSince)
            .toHaveBeenCalledWith(gmail, "a@b.c", Math.floor(GRANTED_AT.getTime() / 1000) - 1);
    });

    it("scans from epoch when both timestamps are missing", async () => {
        vi.mocked(getMessageIds).mockRejectedValue(notFound);
        await catchUpMailbox({ ...mailbox, historyIdBasisAt: null, tokenGrantedAt: null } as never);
        expect(listMessageIdsSince).toHaveBeenCalledWith(gmail, "a@b.c", 0);
    });

    it("does not advance the basis when getProfile fails after the fallback scan", async () => {
        vi.mocked(getMessageIds).mockRejectedValue(notFound);
        vi.mocked(gmail.users.getProfile).mockRejectedValue(Object.assign(new Error("boom"), { code: 503 }));
        await expect(catchUpMailbox(mailbox)).rejects.toThrow("boom");
        expect(advanceBasis).not.toHaveBeenCalled();
    });

    it("treats a 404 from messages.get as an ordinary error, not a fallback trigger", async () => {
        vi.mocked(getDataFromMessages).mockRejectedValue(notFound);
        await expect(catchUpMailbox(mailbox)).rejects.toThrow("not found");
        expect(listMessageIdsSince).not.toHaveBeenCalled();
        expect(setAccessFailure).toHaveBeenCalledWith("a@b.c", "error");
        expect(advanceBasis).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 10: Run to verify they fail**

Run: `npx vitest run src/gmail/catchUpMailbox.test.ts`
Expected: FAIL — fallback not implemented.

- [ ] **Step 11: Implement the fallback path**

Private `runFallbackPass(gmail, mailbox)`: compute `const since = mailbox.historyIdBasisAt ?? mailbox.tokenGrantedAt ?? new Date(0);` → `const ids = await listMessageIdsSince(gmail, mailbox.email, Math.max(0, Math.floor(since.getTime() / 1000) - 1));` → `gmail.users.getProfile({ userId: mailbox.email })`, require `typeof data.historyId === "string"` (else throw `'No history id from getProfile'`) → `ingestAndDeliver(gmail, mailbox, ids, profileData.historyId, "messages_fallback")`. Any throw from this path goes through `handleAccessError` like every other non-404 error (404 inside the fallback is just an error).

- [ ] **Step 12: Run the full file and the whole suite**

Run: `npx vitest run src/gmail/catchUpMailbox.test.ts && npm test && npm run typecheck && npm run lint`
Expected: all green.

- [ ] **Step 13: Commit**

```bash
git add src/gmail/catchUpMailbox.ts src/gmail/catchUpMailbox.test.ts
git commit -m "feat: implement catch-up replay core (FR-14)"
```

---

### Task 5: `runCatchUpPass` job, `CATCHUP_TICK`, scheduler registration

**Files:**
- Create: `src/scheduler/jobs/catchUpPass.ts`
- Test: `src/scheduler/jobs/catchUpPass.test.ts`
- Modify: `src/constants.ts` (add `CATCHUP_TICK`)
- Modify: `src/scheduler/index.ts`

**Interfaces:**
- Consumes: `replayFailed(): Promise<number>`, `listActive(): Promise<{ mailbox: MailboxesTable; chatId: string }[]>` (`mailboxRepository`), `catchUpMailbox(mailbox): Promise<CatchUpResult>` (Task 4).
- Produces: `runCatchUpPass(): Promise<void>` — module-mutexed exactly like `runDeliveryPass` (`inFlight` + `.finally` re-arm); `CATCHUP_TICK = "0 3 * * *"` in `src/constants.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/notificationRepository", () => ({ replayFailed: vi.fn() }));
vi.mock("../../db/mailboxRepository", () => ({ listActive: vi.fn() }));
vi.mock("../../gmail/catchUpMailbox", () => ({ catchUpMailbox: vi.fn() }));

import { runCatchUpPass } from "./catchUpPass";
import { replayFailed } from "../../db/notificationRepository";
import { listActive } from "../../db/mailboxRepository";
import { catchUpMailbox } from "../../gmail/catchUpMailbox";

const active = [
    { mailbox: { id: 1, email: "a@b.c" }, chatId: "42" },
    { mailbox: { id: 2, email: "d@e.f" }, chatId: "43" },
];

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(replayFailed).mockResolvedValue(0);
    vi.mocked(listActive).mockResolvedValue(active as never);
    vi.mocked(catchUpMailbox).mockResolvedValue({ outcome: "ok", source: "history", scanned: 0, inserted: 0, delivered: 0 });
});

describe("runCatchUpPass", () => {
    it("replays failed rows before scanning the first mailbox (FR-11 → FR-14)", async () => {
        await runCatchUpPass();
        expect(replayFailed).toHaveBeenCalledTimes(1);
        expect(catchUpMailbox).toHaveBeenCalledTimes(2);
        expect(vi.mocked(replayFailed).mock.invocationCallOrder[0])
            .toBeLessThan(vi.mocked(catchUpMailbox).mock.invocationCallOrder[0]);
    });

    it("keeps scanning the remaining mailboxes when one rejects", async () => {
        vi.mocked(catchUpMailbox).mockRejectedValueOnce(new Error("dead token"));
        await expect(runCatchUpPass()).resolves.toBeUndefined();
        expect(catchUpMailbox).toHaveBeenCalledTimes(2);
    });

    it("runs a single pass for concurrent callers (mutex)", async () => {
        let release!: () => void;
        vi.mocked(replayFailed).mockReturnValue(new Promise((r) => { release = () => r(0); }));
        const first = runCatchUpPass();
        const second = runCatchUpPass();
        release();
        await Promise.all([first, second]);
        expect(replayFailed).toHaveBeenCalledTimes(1);
    });

    it("re-arms the mutex after a rejected pass settles", async () => {
        vi.mocked(replayFailed).mockRejectedValueOnce(new Error("db down"));
        await expect(runCatchUpPass()).rejects.toThrow("db down");
        await runCatchUpPass();
        expect(replayFailed).toHaveBeenCalledTimes(2);
        expect(catchUpMailbox).toHaveBeenCalledTimes(2);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/scheduler/jobs/catchUpPass.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `runCatchUpPass`**

Mirror `deliverNotifications.ts` exactly for the mutex (`inFlight`, `.finally(() => { inFlight = null; })`). Body: `replayFailed()` → `listActive()` → per-row `try { const r = await catchUpMailbox(row.mailbox); console.log({ event: "catch_up_mailbox", email: row.mailbox.email, ...r }) } catch (err) { console.log({ event: "catch_up_mailbox_failed", email: row.mailbox.email, err: String(err) }) }` → final `console.log({ event: "catch_up_pass", replayed, mailboxes: active.length })`. Skipped/ok/failed counters in the final log are welcome but not required by any consumer.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/scheduler/jobs/catchUpPass.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Register the daily cron**

In `src/constants.ts`: `export const CATCHUP_TICK = "0 3 * * *";`
In `src/scheduler/index.ts`, copy the `deliveryJob` block: `new Cron(CATCHUP_TICK, { protect: … job: "catch_up_pass" …, catch: … }, runCatchUpPass)`, push to `jobs`, `trigger()`, and log `{ event: "scheduler_started", job: "catch_up_pass", tick: CATCHUP_TICK, nextRun: … }`. (Wiring is typecheck-only — no scheduler/index test precedent.)

- [ ] **Step 6: Run full gates**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green (**24 files / 135 tests** — 111 baseline + 2 Task 2 + 5 Task 3 + 13 Task 4 + 4 Task 5).

- [ ] **Step 7: Commit**

```bash
git add src/scheduler/jobs/catchUpPass.ts src/scheduler/jobs/catchUpPass.test.ts src/constants.ts src/scheduler/index.ts
git commit -m "feat: add daily catch-up pass with failed replay (FR-14)"
```

---

### Task 6: Trigger wiring — restart downtime flag, startup, OAuth callback

**Files:**
- Modify: `src/startup/announceRestart.ts`
- Test: `src/startup/announceRestart.test.ts`
- Modify: `src/index.ts:21-29`
- Modify: `src/auth/callback.ts:110-113`

**Interfaces:**
- Consumes: `runCatchUpPass(): Promise<void>` (Task 5), `catchUpMailbox(mailbox): Promise<CatchUpResult>` (Task 4), `getMailbox(email)` (existing).
- Produces: `announceRestart(now?: Date): Promise<boolean>` — `true` when a downtime gap was found (messages sent, heartbeat touched), `false` on a routine restart (heartbeat touched only).

- [ ] **Step 1: Write the failing tests for the return value**

In `src/startup/announceRestart.test.ts` change three assertions (keep everything else):

```ts
it("notifies every active chat when no heartbeat exists yet", async () => {
    ...
    await expect(announceRestart(now)).resolves.toBe(true);
});
it("stays silent on a routine restart with a fresh heartbeat", async () => {
    ...
    await expect(announceRestart(now)).resolves.toBe(false);
});
it("keeps going when a chat send fails (best-effort)", async () => {
    ...
    await expect(announceRestart(now)).resolves.toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/startup/announceRestart.test.ts`
Expected: FAIL — resolves to `undefined`.

- [ ] **Step 3: Return the downtime flag**

In `announceRestart`: return `false` in the fresh-heartbeat branch (after `touchHeartbeat`), `true` at the end of the downtime branch. Nothing else changes.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/startup/announceRestart.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 4b: Wire `src/index.ts`**

Replace the startup `try` block:

```ts
let wasDown = false;
try {
    wasDown = await announceRestart();
} catch (err) {
    console.log({ event: "announce_restart_failed", err: String(err) });
}
if (wasDown)
    void runCatchUpPass().catch((err) =>
        console.log({ event: "catch_up_startup_failed", err: String(err) }));
startScheduler();
```

(Fire-and-forget before `startScheduler()`: the job's own startup `trigger()` joins the same in-flight pass when it overlaps — the mutex collapses the two into one run; a rare sequential double-run is idempotent and cheap, per spec §5.1/§5.3.)

- [ ] **Step 5: Wire `src/auth/callback.ts`**

After `res.status(200).sendFile(join(PUBLIC_DIR, "success.html"));` (line 112), before `return [tokens]`, insert exactly spec §5.2:

```ts
if (existing !== null && existing.historyIdBasis !== null)
    void getMailbox(email)
        .then((m) => (m === null ? undefined : catchUpMailbox(m)))
        .catch((err) => console.log({ event: "catch_up_failed", email, err: String(err) }));
```

Add imports: `catchUpMailbox` from `../gmail/catchUpMailbox`; `getMailbox` is already imported. (`existing` was read before `createMailbox`, which preserves the basis on conflict — this is the "basis preserved" test of FR-3; a fresh link has `historyIdBasis === null` and is skipped here *and* by the core.)

- [ ] **Step 6: Run full gates**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green (24 files / 135 tests); `index.ts` and `callback.ts` are wiring-only (typecheck-covered, per the testing convention).

- [ ] **Step 7: Commit**

```bash
git add src/startup/announceRestart.ts src/startup/announceRestart.test.ts src/index.ts src/auth/callback.ts
git commit -m "feat: trigger catch-up on restart downtime and re-login"
```

---

## Post-plan deploy note

`npm run db:generate` only writes the migration; the target database needs `npm run db:migrate` applied at deploy time before this branch runs. No `.env` changes are required (`CATCHUP_TICK` is a constant, like the other ticks).
