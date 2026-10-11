import { describe, expect, it } from "vitest";
import { isResponseTemplate } from "./isResponseTemplate";

describe("isResponseTemplate (FR-5 gate)", () => {
    it("passes every subject when no patterns are configured (domain-only mode)", () => {
        expect(isResponseTemplate("Weekly digest", [])).toBe(true);
    });

    it("passes a subject containing a configured pattern, case-insensitively", () => {
        expect(isResponseTemplate("Ответ на отклик: вакансия Dev", ["ответ на отклик"])).toBe(true);
    });

    it("rejects a subject matching no pattern", () => {
        expect(isResponseTemplate("Weekly digest", ["ответ на отклик", "вакансия"])).toBe(false);
    });

    it("matches any of several patterns", () => {
        expect(isResponseTemplate("Вакансия Developer", ["ответ на отклик", "вакансия"])).toBe(true);
    });
});
