import { join } from "path";

export const PUBLIC_DIR=join(__dirname,"..","public");

export const BACKOFF_VALUE_MS=5_000;
export const BACKOFF_MULT=3;
export const MAX_NOTIFICATION_ATTEMPTS=5;
export const STALE_PENDING_MS=5*60*1000;
export const KEY_EXPIRE_MS=5*60*1000;
export const TOKEN_EXPIRE_MS=7*24*60*60*1000;
export const MESSAGE_FOR_NO_MAILBOX_CONNECTED='No mailbox is connected right now run.\nRun /start to connect one';
export const MESSAGE_FOR_UNLINK_CONFIRMATION=(email:string,scopes:string)=>
    `Mailbox ${email} has been unlinked.\nWatch stopped, access revoked (${scopes}).\nRun /start to connect a mailbox again`;
export const MESSAGE_MAILBOX_RELINKED=(email:string)=>
    `Mailbox ${email} is now linked to a different Telegram account.\nNotifications for this chat have stopped`;
export const createReplacedMailboxMessage=(oldEmail:string,newEmail:string)=>
    `Previous mailbox ${oldEmail} was unlinked because you linked ${newEmail}`;
export const MESSAGE_FOR_AUTH_CANCELLED='Authorization was cancelled.\nRun /start to try again';
export const MESSAGE_FOR_AUTH_FAILED='Something went wrong while linking your mailbox.\nRun /start to try again';
export const REVOKED_SCOPES='openid, userinfo.email, gmail.readonly';