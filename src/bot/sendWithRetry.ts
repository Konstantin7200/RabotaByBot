import { sendMessage } from "./sendMessage";
import { classifySendError } from "./classifySendError";

// One-shot notices (FR-12 access loss, FR-13 recovery/back-online) are sent
// from contexts that do not retry them later, so a single transient Telegram
// error must not swallow the message. Permanent failures (blocked chat) are
// not retried; transient ones back off linearly up to the attempt limit.
export const NOTICE_SEND_ATTEMPTS = 3;
export const NOTICE_SEND_RETRY_DELAY_MS = 1_000;

export type SendRetryOptions = {
    attempts?: number;
    retryDelayMs?: number;
    sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function sendWithRetry(chatId: number, text: string, opts?: SendRetryOptions): Promise<void> {
    const attempts = opts?.attempts ?? NOTICE_SEND_ATTEMPTS;
    const delayMs = opts?.retryDelayMs ?? NOTICE_SEND_RETRY_DELAY_MS;
    const sleep = opts?.sleep ?? defaultSleep;
    let lastError: unknown = new Error("No send attempts configured");
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            await sendMessage(chatId, text);
            return;
        } catch (err) {
            lastError = err;
            if (classifySendError(err) === "blocked")
                throw err;
            if (attempt < attempts)
                await sleep(delayMs * attempt);
        }
    }
    throw lastError;
}
