# Rabota.by notification bot

Multi-user Telegram bot that watches linked Gmail mailboxes for replies from
Rabota.by and pushes a notification to the Telegram chat that linked the
mailbox. Push-driven (Gmail watch → Cloud Pub/Sub → HTTPS webhook), no polling
of new mail in steady state.

Companion documents: [`Technical assignment (RU).md`](./Technical%20assignment%20%28RU%29.md),
[`User stories (RU).md`](./User%20stories%20%28RU%29.md).

## Architecture

```mermaid
flowchart LR
    TG[Telegram] -- updates -->|X-Telegram-Bot-Api-Secret-Token| WH[POST /telegram/webhook]
    WH --> BOT[grammY bot\n/ start · / status · / unlink]
    BOT --> OAUTH[POST /oauth/callback\nOAuth success / error pages]
    OAUTH --> PG1[(PostgreSQL)]
    OAUTH --> GAPI[Gmail API\nusers.watch]
    GAPI --> TOPIC[GCP Pub/Sub topic]
    TOPIC -- push --> PS[POST /gmail/notification\nOIDC verified]
    PS --> H[history.list from stored basis\nfilter: From = rabota.by]
    H --> J[(notifications journal\npending → sent | failed)]
    J --> TGS[Telegram send]
    CRON[Scheduler cron] --> R[renew watches daily\nFR-10]
    CRON --> D[delivery retries every 10 s\nFR-11]
    CRON --> C[catch-up pass 03:00\nFR-14]
    CRON --> W[warn on expiring login\nUS-8]
    CRON --> RT[retention cleanup 04:00\n30 days]
    R --> GAPI
    C --> H
    D --> TGS
    PG1 -.-> CRON
```

## Commands

| Command | What it does |
|---|---|
| `/start` | Starts Google OAuth (scope `gmail.readonly`, offline access) and links the mailbox to this chat. Also re-links / restores access. |
| `/status` | Shows linked email, login expiry, watch state and delivery problems. |
| `/unlink` | Stops the watch, revokes the refresh token, clears credentials, keeps the dedup journal. |

## Setup

### 1. Google Cloud

1. Create a project, enable the **Gmail API**.
2. Create an **OAuth client ID** (Web application) with the redirect URI
   `https://<your-host>/oauth/callback`. Add yourself as a test user while the
   consent screen is in *testing* mode (≤ 100 users; refresh tokens then expire
   after 7 days — the bot warns you before that).
3. Create a **Pub/Sub topic** and a push subscription pointing at
   `https://<your-host>/gmail/notification`.
4. Grant the topic role `roles/pubsub.publisher` to the service account
   `gmail-api-push@system.gserviceaccount.com` (Gmail uses it to publish
   watch notifications).

### 2. Telegram

1. Create a bot with [@BotFather](https://t.me/BotFather), copy the token.
2. Generate a webhook secret (`openssl rand -hex 32`) — it will be sent as
   `X-Telegram-Bot-Api-Secret-Token` and must match `TELEGRAM_WEBHOOK_SECRET`.

### 3. Database

Any PostgreSQL 14+. Create a database and run migrations:

```bash
npm install
npm run db:migrate
```

### 4. Environment

Copy `.env.example` to `.env` and fill in every value — each variable is
documented inline there.

> **Fresh-start note:** refresh tokens are now stored encrypted
> (`TOKEN_ENCRYPTION_KEY`). Tokens written by older versions are treated as
> invalid; those users simply re-link with `/start`.

### 5. Run

```bash
npm run dev     # hot reload
npm run build && npm start
npm test        # vitest
npm run lint
npm run typecheck
```

## Deploy

Works on any always-on host with public HTTPS (Railway, Fly.io, …). A host
with a sleeping free tier violates the latency requirement — do not use one.

- Set every variable from `.env.example`; `PUBLIC_BASE_URL` must be the public
  `https://` origin (no trailing slash).
- On boot the bot registers the Telegram webhook
  (`PUBLIC_BASE_URL/telegram/webhook`) and renews Gmail watches at least daily.
- `SIGTERM`/`SIGINT` stop the scheduler, drain in-flight jobs (up to 5 s) and
  close the HTTP server; a 10 s force-exit is the backstop.

## Open risks and accepted deviations

| Item | Status |
|---|---|
| Real Rabota.by letter format (sender, subject templates) **not yet confirmed** (§6.3 of the assignment). The domain filter (`rabota.by`) and subject parsing patterns are best-effort and unconfirmed. | Open — verify against a real reply sample before trusting FR-5/FR-6 in production. |
| FR-5 "matches the response template" gate | Partial: every letter from the `rabota.by` domain notifies by default; set `RABOTA_SUBJECT_PATTERNS` (comma-separated subject substrings) to enable the gate once real subjects are confirmed. |
| US-9 / US-10 transient failures | Narrowed scope (agreed): quick transient Gmail errors do not message the user; a notice is sent only after 3 consecutive failures (once), and a "working again" message only goes to owners who were notified. Hard access loss still messages immediately (FR-12). |
| Journal retention | Sent rows older than 30 days are deleted by the daily `retention_cleanup` job (04:00); pending/failed rows are kept until they reach a terminal state. |
| Google consent screen mode | `GOOGLE_CONSENT_MODE=testing` (default): refresh tokens expire in 7 days; `/status` shows the computed expiry and a once-per-grant advance warning is sent 24 h before it (US-8). Set `production` to drop the fixed-expiry messaging. |

## Manual acceptance checklist (release gate)

- [ ] US-1 – US-11 verified end-to-end on a deployed instance
- [ ] 7-day refresh-token expiry scenario: FR-12 message arrives, `/start`
      restores (FR-13), missed updates are delivered (FR-14)
- [ ] Watch renewal visible in logs at least daily
- [ ] Simulated Pub/Sub redeliveries, webhook retries and process restarts: no
      duplicates in normal scenarios, no losses (documented crash window only)
- [ ] NFRs: p95 ≤ 60 s in steady state; token encryption; webhook secret +
      Pub/Sub OIDC checks; one-time OAuth state; clean SIGTERM
- [ ] Lint & typecheck green; no secrets committed; `.env.example` complete
