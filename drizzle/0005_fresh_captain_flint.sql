ALTER TABLE "mailboxes" ADD COLUMN "tokenExpiryWarnedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD COLUMN "consecutiveTransientFailures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD COLUMN "failureNotifiedAt" timestamp with time zone;