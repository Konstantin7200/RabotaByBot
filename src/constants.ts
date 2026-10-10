import { join } from "path";

export const PUBLIC_DIR=join(__dirname,"..","public");

export const BACKOFF_VALUE_MS=5_000;
export const BACKOFF_MULT=3;
export const MAX_NOTIFICATION_ATTEMPTS=5;
export const STALE_PENDING_MS=24*60*60*1000; // applied only on boot (FR-7 "при восстановлении"); must exceed the full retry schedule + inline budget so an ordinary restart delivers instead of losing
export const INLINE_DELIVERY_BUDGET_MS=4*60*1000; // << STALE_PENDING_MS (24 h)
export const BATCH_POLL_MIN_MS=1_000;
export const BATCH_POLL_MAX_MS=30_000;
export const TOKEN_EXPIRE_MS=7*24*60*60*1000;
export const WATCH_RENEWAL_TICK="*/30 * * * *";
export const WATCH_RENEWAL_MIN_INTERVAL_MS=24*60*60*1000;
export const DELIVERY_TICK="*/10 * * * * *";
export const CATCHUP_TICK="0 3 * * *";
export const WATCH_RENEWAL_THRESHOLD_MS=24*60*60*1000;
export const TOKEN_EXPIRY_WARNING_MS=24*60*60*1000;
export const TOKEN_EXPIRY_WARN_TICK='0 * * * *';
export const PERSISTENT_FAILURE_THRESHOLD=3;
export const RETENTION_DAYS=30;
export const RETENTION_TICK='0 4 * * *';
export const MESSAGE_WATCH_EXPIRED=(email:string)=>
    `Google login for ${email} has expired.\nRun /start to link the mailbox again`;
export const MESSAGE_WATCH_RENEW_ERROR=(email:string)=>
    `Could not renew tracking for ${email} (Google API error).\nRun /start to re-link if it persists`;
export const MESSAGE_MAIL_PROCESSING_ERROR=(email:string)=>
    `Could not process new mail for ${email} (Google API error).\nRun /start to re-link if it persists`;
export const MESSAGE_LOGIN_SUCCESS=(email:string)=>
    `You were successfully logged in with ${email}`;
export const MESSAGE_ACCESS_RESTORED=(email:string)=>
    `Access to ${email} restored.\nMail tracking is running again`;
export const MESSAGE_BACK_ONLINE='Back online.\nMail tracking is running again';
export const chooseLoginMessage=(email:string,previousStatus:string|null)=>
    previousStatus==='expired'||previousStatus==='revoked'||previousStatus==='error'
        ? MESSAGE_ACCESS_RESTORED(email)
        : MESSAGE_LOGIN_SUCCESS(email);
export const DOWNTIME_THRESHOLD_MS=5*60*1000;
export const HEARTBEAT_TICK='*/1 * * * *';
export const MESSAGE_FOR_NO_MAILBOX_CONNECTED='No mailbox is connected right now run.\nRun /start to connect one';
export const MESSAGE_FOR_UNLINK_CONFIRMATION=(email:string,scopes:string)=>
    `Mailbox ${email} has been unlinked.\nWatch stopped, access revoked (${scopes}).\nRun /start to connect a mailbox again`;
export const MESSAGE_FOR_UNLINK_INCOMPLETE=(email:string,failedSteps:string)=>
    `Mailbox ${email} has been unlinked from the bot, but Google-side cleanup did not fully complete (${failedSteps}).\nRevoke the app's access at https://myaccount.google.com/permissions if it is still listed there`;
export const MESSAGE_MAILBOX_RELINKED=(email:string)=>
    `Mailbox ${email} is now linked to a different Telegram account.\nNotifications for this chat have stopped`;
export const createReplacedMailboxMessage=(oldEmail:string,newEmail:string)=>
    `Previous mailbox ${oldEmail} was unlinked because you linked ${newEmail}`;
export const MESSAGE_FOR_AUTH_CANCELLED='Authorization was cancelled.\nRun /start to try again';
export const MESSAGE_FOR_AUTH_FAILED='Something went wrong while linking your mailbox.\nRun /start to try again';
export const REVOKED_SCOPES='openid, userinfo.email, gmail.readonly';
export const MESSAGE_CHAT_BLOCKED='Warning: the bot was blocked in this chat.\nNotifications cannot be delivered until it is unblocked';
export const MESSAGE_LOGIN_EXPIRING_SOON=(email:string,expiresAt:Date)=>
    `Warning: the Google login for ${email} expires soon (${expiresAt.toUTCString()}).\nRun /start to renew it before tracking stops`;
export const MESSAGE_PERSISTENT_FAILURE=(email:string)=>
    `Mail tracking for ${email} keeps failing.\nRun /status for details, or /start to re-link the mailbox`;
export const MESSAGE_DELIVERY_RESTORED=(email:string)=>
    `Mail tracking for ${email} is working again`;
export const createDeliveryProblemsWarning=(stuckCount:number,lastError:string|null,attempts:number)=>{
    const stuck=stuckCount>0?`${stuckCount} notification(s) not delivered yet; `:'';
    return `Warning: delivery problems: ${stuck}last error after ${attempts} attempt(s): ${lastError??'unknown'}`;
};
