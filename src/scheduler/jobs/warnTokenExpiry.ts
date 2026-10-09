import { EnvConfig } from "../../config";
import { listDueForTokenExpiryWarning, markTokenExpiryWarned } from "../../db/mailboxRepository";
import { notifyMailboxOwner } from "../../bot/notifyMailboxOwner";
import { MESSAGE_LOGIN_EXPIRING_SOON, TOKEN_EXPIRE_MS, TOKEN_EXPIRY_WARNING_MS } from "../../constants";

// US-8: warn each owner at most once per grant when the (testing-mode) login
// is about to expire, so tracking does not stop silently after 7 days.
export async function warnTokenExpiry() {
    if (EnvConfig.googleConsentMode === "production") {
        console.log({ event: "token_expiry_warning_skipped", reason: "production_consent" });
        return;
    }
    const candidates = await listDueForTokenExpiryWarning();
    const now = Date.now();
    let warned = 0;
    for (const mailbox of candidates) {
        if (mailbox.tokenGrantedAt === null)
            continue;
        const expiresAt = new Date(mailbox.tokenGrantedAt.getTime() + TOKEN_EXPIRE_MS);
        const remaining = expiresAt.getTime() - now;
        if (remaining <= 0 || remaining > TOKEN_EXPIRY_WARNING_MS)
            continue;
        await markTokenExpiryWarned(mailbox.id);
        await notifyMailboxOwner(mailbox.id, MESSAGE_LOGIN_EXPIRING_SOON(mailbox.email, expiresAt));
        warned += 1;
    }
    console.log({ event: "token_expiry_warning_check", candidates: candidates.length, warned });
}
