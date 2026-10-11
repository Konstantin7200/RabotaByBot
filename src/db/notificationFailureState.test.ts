import { describe, expect, it } from "vitest";
import { nextFailureState } from "./notificationFailureState";

const now = new Date("2026-10-08T12:00:00.000Z");
const pending = (attempts: number) => ({ attempts, status: "pending" as const });

describe("nextFailureState", () => {
    it("schedules exponential backoff 5s, 15s, 45s, 135s", () => {
        expect(nextFailureState(pending(0), "boom", now).nextAttemptAt.getTime() - now.getTime()).toBe(5_000);
        expect(nextFailureState(pending(1), "boom", now).nextAttemptAt.getTime() - now.getTime()).toBe(15_000);
        expect(nextFailureState(pending(2), "boom", now).nextAttemptAt.getTime() - now.getTime()).toBe(45_000);
        expect(nextFailureState(pending(3), "boom", now).nextAttemptAt.getTime() - now.getTime()).toBe(135_000);
    });
    it("stays pending while attempts remain", () => {
        expect(nextFailureState(pending(0), "boom", now)).toMatchObject({ attempts: 1, status: "pending", lastError: "boom" });
    });
    it("moves to failed on the fifth failure", () => {
        expect(nextFailureState(pending(4), "boom", now)).toMatchObject({ attempts: 5, status: "failed" });
    });
});
