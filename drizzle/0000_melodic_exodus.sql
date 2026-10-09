CREATE TYPE "public"."access_status" AS ENUM('unlinked', 'active', 'expired', 'revoked', 'error');--> statement-breakpoint
CREATE TYPE "public"."chat_status" AS ENUM('ok', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
CREATE TABLE "mailboxes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "mailboxes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"userId" integer,
	"email" text NOT NULL,
	"refreshToken" text,
	"tokenGrantedAt" timestamp with time zone,
	"watchExpiration" timestamp with time zone,
	"historyIdBasis" text,
	"lastDeliveredAt" timestamp with time zone,
	"accessStatus" "access_status" DEFAULT 'unlinked' NOT NULL,
	"linkedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mailboxes_userId_unique" UNIQUE("userId"),
	CONSTRAINT "mailboxes_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "notifications_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"mailboxId" integer NOT NULL,
	"gmailMessageId" text NOT NULL,
	"status" "notification_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"nextAttemptAt" timestamp with time zone DEFAULT now() NOT NULL,
	"fromHeader" text,
	"subject" text,
	"vacancy" text,
	"employer" text,
	"outcome" text,
	"sentAt" timestamp with time zone,
	"lastError" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"state" text PRIMARY KEY NOT NULL,
	"chatId" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_states_chatId_unique" UNIQUE("chatId")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"chatId" text NOT NULL,
	"chatStatus" "chat_status" DEFAULT 'ok' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_chatId_unique" UNIQUE("chatId")
);
--> statement-breakpoint
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_mailboxId_mailboxes_id_fk" FOREIGN KEY ("mailboxId") REFERENCES "public"."mailboxes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_mailbox_id_gmail_message_id_unique" ON "notifications" USING btree ("mailboxId","gmailMessageId");--> statement-breakpoint
CREATE INDEX "notifications_status_next_attempt_at_idx" ON "notifications" USING btree ("status","nextAttemptAt");