import { BACKOFF_MULT, BACKOFF_VALUE_MS, MAX_NOTIFICATION_ATTEMPTS } from "../constants";

export type FailureStateInput = { attempts: number; status: "pending" | "sent" | "failed" };
export type FailureState = { attempts: number; status: "pending" | "failed"; nextAttemptAt: Date; lastError: string };

export function nextFailureState(input: FailureStateInput, error: string, now: Date): FailureState {
    const attempts = input.attempts + 1;
    return {
        attempts,
        status: attempts >= MAX_NOTIFICATION_ATTEMPTS ? "failed" : "pending",
        nextAttemptAt: new Date(now.getTime() + BACKOFF_VALUE_MS * Math.pow(BACKOFF_MULT, input.attempts)),
        lastError: error,
    };
}
