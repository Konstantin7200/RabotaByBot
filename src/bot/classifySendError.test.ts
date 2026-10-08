import { describe, expect, it } from "vitest";
import { classifySendError } from "./classifySendError";

function tgError(props: { errorCode?: number; code?: number | string; responseStatus?: number }) {
    const err = new Error("tg") as Error & {
        error_code?: number; code?: number | string; response?: { status?: number };
    };
    if (props.errorCode !== undefined) err.error_code = props.errorCode;
    if (props.code !== undefined) err.code = props.code;
    if (props.responseStatus !== undefined) err.response = { status: props.responseStatus };
    return err;
}

describe("classifySendError", () => {
    it("classifies grammY 403 as blocked", () => {
        expect(classifySendError(tgError({ errorCode: 403 }))).toBe("blocked");
    });
    it("classifies 429 as retryable", () => {
        expect(classifySendError(tgError({ errorCode: 429 }))).toBe("retryable");
    });
    it("classifies network failures as retryable", () => {
        expect(classifySendError(tgError({ code: "ECONNRESET" }))).toBe("retryable");
    });
    it("classifies unknown errors as retryable", () => {
        expect(classifySendError(undefined)).toBe("retryable");
        expect(classifySendError(new Error("boom"))).toBe("retryable");
    });
});
