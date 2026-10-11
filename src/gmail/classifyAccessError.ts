export type AccessErrorKind = "expired" | "error" | "transient";

function getStatusCode(err: unknown): number | undefined {
    if (typeof err !== "object" || err === null)
        return undefined;
    const withCode = err as { code?: unknown };
    if (typeof withCode.code === "number")
        return withCode.code;
    const withResponse = err as { response?: { status?: unknown } };
    if (typeof withResponse.response?.status === "number")
        return withResponse.response.status;
    return undefined;
}

function isNetworkErrorCode(err: unknown): boolean {
    if (typeof err !== "object" || err === null)
        return false;
    const withCode = err as { code?: unknown };
    return typeof withCode.code === "string";
}

// gaxios surfaces Google API errors as response.data.error.errors[].reason.
function getFailureReason(err: unknown): string | undefined {
    if (typeof err !== "object" || err === null)
        return undefined;
    const withResponse = err as {
        response?: { data?: { error?: { errors?: Array<{ reason?: unknown }> } } };
    };
    const errors = withResponse.response?.data?.error?.errors;
    if (!Array.isArray(errors))
        return undefined;
    for (const entry of errors)
        if (typeof entry?.reason === "string")
            return entry.reason;
    return undefined;
}

// Google reports quota and rate limiting as 403, not only as 429.
const TRANSIENT_403_REASONS = new Set([
    "rateLimitExceeded",
    "userRateLimitExceeded",
    "quotaExceeded",
]);

function getMessage(err: unknown): string {
    if (err instanceof Error)
        return err.message;
    return String(err);
}

export function classifyAccessError(err: unknown): AccessErrorKind {
    if (getMessage(err).includes("invalid_grant"))
        return "expired";
    if (isNetworkErrorCode(err))
        return "transient";
    const status = getStatusCode(err);
    if (status === undefined)
        return "transient";
    if (status === 429 || status >= 500)
        return "transient";
    // A 404 is a stale history id, a message deleted by the user, or a
    // misconfigured push topic - none of those mean the login is gone.
    // Locking the mailbox (FR-12) on them would stop tracking until /start.
    if (status === 404)
        return "transient";
    if (status === 403) {
        const reason = getFailureReason(err);
        if (reason !== undefined && TRANSIENT_403_REASONS.has(reason))
            return "transient";
    }
    return "error";
}

export function isHistoryUnavailable(err: unknown): boolean {
    return getStatusCode(err) === 404;
}
