import { mailboxesTable, notificationsTable, oauthKeysTable, usersTable } from "./schema";

export type InsertedUser=typeof usersTable.$inferInsert;
export type InsertedKey=typeof oauthKeysTable.$inferInsert;
export type InsertedMailbox=typeof mailboxesTable.$inferInsert;
export type InsertedNotification=typeof notificationsTable.$inferInsert;

export type User=typeof usersTable.$inferSelect;
export type Key=typeof oauthKeysTable.$inferSelect;
export type MailboxesTable=typeof mailboxesTable.$inferSelect;
export type Notification=typeof notificationsTable.$inferSelect;