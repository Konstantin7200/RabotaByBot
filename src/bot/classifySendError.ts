export type SendErrorKind = "blocked" | "retryable";

function getStatusCode(err: unknown): number | undefined {
    if (typeof err !== "object" || err === null)
        return undefined;
    const withErrorCode = err as { error_code?: unknown };
    if (typeof withErrorCode.error_code === "number")
        return withErrorCode.error_code;
    const withCode = err as { code?: unknown };
    if (typeof withCode.code === "number")
        return withCode.code;
    const withResponse = err as { response?: { status?: unknown } };
    if (typeof withResponse.response?.status === "number")
        return withResponse.response.status;
    return undefined;
}

export function classifySendError(err: unknown): SendErrorKind {
    if (getStatusCode(err) === 403)
        return "blocked";
    return "retryable";
}
