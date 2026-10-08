import { describe, expect, it } from "vitest";
import { classifyRenewalError } from "./classifyRenewalError";

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

describe("classifyRenewalError", () => {
    it("classifies invalid_grant as expired", () => {
        const err = gaxiosError({ code: 400, message: "invalid_grant: Token has been expired or revoked." });
        expect(classifyRenewalError(err)).toBe("expired");
    });

    it("classifies invalid_grant without numeric code as expired", () => {
        const err = new Error("invalid_grant");
        expect(classifyRenewalError(err)).toBe("expired");
    });

    it("classifies 429 as transient", () => {
        expect(classifyRenewalError(gaxiosError({ code: 429 }))).toBe("transient");
    });

    it("classifies 500 as transient", () => {
        expect(classifyRenewalError(gaxiosError({ code: 500 }))).toBe("transient");
    });

    it("classifies 503 from response status as transient", () => {
        expect(classifyRenewalError(gaxiosError({ responseStatus: 503 }))).toBe("transient");
    });

    it("classifies network error codes as transient", () => {
        expect(classifyRenewalError(gaxiosError({ code: "ETIMEDOUT" }))).toBe("transient");
        expect(classifyRenewalError(gaxiosError({ code: "ECONNRESET" }))).toBe("transient");
        expect(classifyRenewalError(gaxiosError({ code: "EAI_AGAIN" }))).toBe("transient");
    });

    it("classifies 403 as error", () => {
        expect(classifyRenewalError(gaxiosError({ code: 403 }))).toBe("error");
    });

    it("classifies 404 as error", () => {
        expect(classifyRenewalError(gaxiosError({ code: 404 }))).toBe("error");
    });

    it("classifies unknown failures as transient", () => {
        expect(classifyRenewalError(undefined)).toBe("transient");
        expect(classifyRenewalError("something odd")).toBe("transient");
        expect(classifyRenewalError(new Error("boom"))).toBe("transient");
    });
});
