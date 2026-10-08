import { describe, expect, it } from "vitest";
import { renderNotification } from "./renderNotification";

describe("renderNotification", () => {
    it("uses the parsed outcome when present", () => {
        expect(renderNotification({ vacancy: "Dev", employer: "ACME", outcome: "Приглашение", subject: "s" }))
            .toBe("The outcome of vacancy Dev from employer ACME is Приглашение");
    });
    it("falls back to subject when outcome is null (FR-6)", () => {
        expect(renderNotification({ vacancy: "Dev", employer: "ACME", outcome: null, subject: "Ваш отклик" }))
            .toContain("Ваш отклик");
    });
    it("falls back to Unknown when nothing is known", () => {
        expect(renderNotification({ vacancy: null, employer: null, outcome: null, subject: null }))
            .toBe("The outcome of vacancy Unknown from employer Unknown is Unknown");
    });
});
