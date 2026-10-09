import {
    pgEnum,
    pgTable,
    integer,
    text,
    timestamp,
    uniqueIndex,
    index,
} from "drizzle-orm/pg-core";

export const chatStatusEnum = pgEnum("chat_status", ["ok", "blocked"]);

export const accessStatusEnum = pgEnum("access_status", [
    "unlinked",
    "active",
    "expired",
    "revoked",
    "error",
]);

export const notificationStatusEnum = pgEnum("notification_status", [
    "pending",
    "sent",
    "failed",
]);

export const usersTable = pgTable("users", {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    chatId: text().notNull().unique(),
    chatStatus: chatStatusEnum("chatStatus").notNull().default("ok"),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const mailboxesTable = pgTable("mailboxes", {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer().unique().references(() => usersTable.id),
    email: text().notNull().unique(),
    refreshToken: text(),
    tokenGrantedAt: timestamp({ withTimezone: true }),
    watchExpiration: timestamp({ withTimezone: true }),
    historyIdBasis: text(),
    historyIdBasisAt: timestamp({ withTimezone: true }),
    lastDeliveredAt: timestamp({ withTimezone: true }),
    accessStatus: accessStatusEnum("accessStatus").notNull().default("unlinked"),
    linkedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const notificationsTable = pgTable(
    "notifications",
    {
        id: integer().primaryKey().generatedAlwaysAsIdentity(),
        mailboxId: integer()
            .notNull()
            .references(() => mailboxesTable.id),
        gmailMessageId: text().notNull(),
        status: notificationStatusEnum("status")
            .notNull()
            .default("pending"),
        attempts: integer().notNull().default(0),
        nextAttemptAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
        fromHeader: text(),
        subject: text(),
        vacancy: text(),
        employer: text(),
        outcome: text(),
        sentAt: timestamp({ withTimezone: true }),
        lastError: text(),
        createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        uniqueIndex("notifications_mailbox_id_gmail_message_id_unique").on(
            table.mailboxId,
            table.gmailMessageId,
        ),
        index("notifications_status_next_attempt_at_idx").on(
            table.status,
            table.nextAttemptAt,
        ),
    ],
);

export const appStateTable = pgTable("app_state", {
    key: text().primaryKey(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const oauthKeysTable = pgTable("oauth_keys", {
    key: text().primaryKey(),
    chatId: text().notNull().unique(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
