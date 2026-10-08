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
    return "error";
}
