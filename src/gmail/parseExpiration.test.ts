import { describe, expect, it } from "vitest";
import { parseExpiration } from "./parseExpiration";

describe("parseExpiration", () => {
    it("parses epoch milliseconds as string (Gmail watch format)", () => {
        const ms = 1791456000000;
        expect(parseExpiration(String(ms)).getTime()).toBe(ms);
    });

    it("parses ISO 8601 strings", () => {
        expect(parseExpiration("2026-10-15T12:00:00.000Z").toISOString())
            .toBe("2026-10-15T12:00:00.000Z");
    });

    it("rejects empty strings", () => {
        expect(() => parseExpiration("")).toThrow("Expiration is empty");
        expect(() => parseExpiration("   ")).toThrow("Expiration is empty");
    });

    it("rejects unparseable strings", () => {
        expect(() => parseExpiration("not-a-date")).toThrow("Invalid expiration value");
    });
});
