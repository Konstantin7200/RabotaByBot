import { describe, expect, it } from "vitest";
import { classifyAccessError, isHistoryUnavailable } from "./classifyAccessError";

function gaxiosError(props: { code?: number | string; responseStatus?: number; message?: string }) {
    const err = new Error(props.message ?? "boom") as Error & {
        code?: number | string;
        response?: { status?: number };
    };
    if (props.code !== undefined)
        err.code = props.code;
    if (props.responseStatus !== undefined)
        err.response = { status: props.responseStatus };
    return err;
}

describe("classifyAccessError", () => {
    it("classifies invalid_grant as expired", () => {
        const err = gaxiosError({ code: 400, message: "invalid_grant: Token has been expired or revoked." });
        expect(classifyAccessError(err)).toBe("expired");
    });

    it("classifies invalid_grant without numeric code as expired", () => {
        const err = new Error("invalid_grant");
        expect(classifyAccessError(err)).toBe("expired");
    });

    it("classifies 429 as transient", () => {
        expect(classifyAccessError(gaxiosError({ code: 429 }))).toBe("transient");
    });

    it("classifies 500 as transient", () => {
        expect(classifyAccessError(gaxiosError({ code: 500 }))).toBe("transient");
    });

    it("classifies 503 from response status as transient", () => {
        expect(classifyAccessError(gaxiosError({ responseStatus: 503 }))).toBe("transient");
    });

    it("classifies network error codes as transient", () => {
        expect(classifyAccessError(gaxiosError({ code: "ETIMEDOUT" }))).toBe("transient");
        expect(classifyAccessError(gaxiosError({ code: "ECONNRESET" }))).toBe("transient");
        expect(classifyAccessError(gaxiosError({ code: "EAI_AGAIN" }))).toBe("transient");
    });

    it("classifies 403 as error", () => {
        expect(classifyAccessError(gaxiosError({ code: 403 }))).toBe("error");
    });

    it("classifies 404 as error", () => {
        expect(classifyAccessError(gaxiosError({ code: 404 }))).toBe("error");
    });

    it("classifies unknown failures as transient", () => {
        expect(classifyAccessError(undefined)).toBe("transient");
        expect(classifyAccessError("something odd")).toBe("transient");
        expect(classifyAccessError(new Error("boom"))).toBe("transient");
    });
});

describe("isHistoryUnavailable", () => {
    it("is true for a 404 from either code or response status", () => {
        expect(isHistoryUnavailable(gaxiosError({ code: 404 }))).toBe(true);
        expect(isHistoryUnavailable(gaxiosError({ responseStatus: 404 }))).toBe(true);
    });
    it("is false for anything else", () => {
        expect(isHistoryUnavailable(gaxiosError({ code: 403 }))).toBe(false);
        expect(isHistoryUnavailable(gaxiosError({ responseStatus: 500 }))).toBe(false);
        expect(isHistoryUnavailable(gaxiosError({ code: "ETIMEDOUT" }))).toBe(false);
        expect(isHistoryUnavailable(new Error("invalid_grant"))).toBe(false);
        expect(isHistoryUnavailable(undefined)).toBe(false);
    });
});
