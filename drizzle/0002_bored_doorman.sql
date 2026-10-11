CREATE TABLE "app_state" (
	"key" text PRIMARY KEY NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_keys" (
	"key" text PRIMARY KEY NOT NULL,
	"chatId" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_keys_chatId_unique" UNIQUE("chatId")
);
--> statement-breakpoint
DROP TABLE "oauth_states" CASCADE;