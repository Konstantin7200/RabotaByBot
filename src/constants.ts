import { join } from "path";

export const PUBLIC_DIR=join(__dirname,"..","public");

export const BACKOFF_VALUE_MS=5_000;
export const BACKOFF_MULT=3;
export const MAX_NOTIFICATION_ATTEMPTS=5;
export const STALE_PENDING_MS=5*60*1000;
export const INLINE_DELIVERY_BUDGET_MS = 4 * 60 * 1000; // < STALE_PENDING_MS (5 min)
export const BATCH_POLL_MIN_MS = 1_000;
export const BATCH_POLL_MAX_MS = 30_000;
export const KEY_EXPIRE_MS=5*60*1000;
export const TOKEN_EXPIRE_MS=7*24*60*60*1000;
export const WATCH_RENEWAL_TICK="*/30 * * * *";
export const DELIVERY_TICK="*/10 * * * * *";
export const WATCH_RENEWAL_THRESHOLD_MS=24*60*60*1000;
export const MESSAGE_WATCH_EXPIRED=(email:string)=>
    `Google login for ${email} has expired.\nRun /start to link the mailbox again`;
export const MESSAGE_WATCH_RENEW_ERROR=(email:string)=>
    `Could not renew tracking for ${email} (Google API error).\nRun /start to re-link if it persists`;
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
export const MESSAGE_CHAT_BLOCKED='Warning: the bot was blocked in this chat.\nNotifications cannot be delivered until it is unblocked';
export const createDeliveryProblemsWarning=(stuckCount:number,lastError:string|null,attempts:number)=>
    `Warning: delivery problems: ${stuckCount} notification(s) not delivered yet; last error after ${attempts} attempt(s): ${lastError??'unknown'}`;