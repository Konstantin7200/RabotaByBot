import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/notificationRepository", () => ({
    getByIds: vi.fn(), markStaleAsSent: vi.fn(), claimDueRetries: vi.fn(),
}));
vi.mock("../scheduler/jobs/deliverNotifications", () => ({ runDeliveryPass: vi.fn() }));

import { deliverBatchUntilTerminal } from "./deliverBatch";
import { getByIds } from "../db/notificationRepository";
import { runDeliveryPass } from "../scheduler/jobs/deliverNotifications";

const pendingRow = { id: 1, status: "pending", nextAttemptAt: new Date("2026-10-08T12:00:10.000Z") } as never;
const sentRow = { id: 1, status: "sent", nextAttemptAt: new Date() } as never;
const instantSleep = vi.fn(() => Promise.resolve());

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(runDeliveryPass).mockResolvedValue(undefined);
});

describe("deliverBatchUntilTerminal", () => {
    it("returns terminal without a pass when rows are already terminal (fast ack path)", async () => {
        vi.mocked(getByIds).mockResolvedValue([sentRow]);
        const sleep = vi.fn(() => Promise.resolve());
        await expect(deliverBatchUntilTerminal([1], { sleep })).resolves.toBe("terminal");
        expect(runDeliveryPass).not.toHaveBeenCalled();
        expect(sleep).not.toHaveBeenCalled();
    });

    it("acknowledges as soon as the pass makes the row terminal, without sleeping", async () => {
        vi.mocked(getByIds).mockResolvedValueOnce([pendingRow]);
        vi.mocked(runDeliveryPass).mockImplementation(async () => {
            vi.mocked(getByIds).mockResolvedValueOnce([sentRow]).mockResolvedValue([sentRow]);
        });
        await expect(deliverBatchUntilTerminal([1], { sleep: instantSleep })).resolves.toBe("terminal");
        expect(runDeliveryPass).toHaveBeenCalledTimes(1);
        expect(instantSleep).not.toHaveBeenCalled();
    });

    it("sleeps until nextAttemptAt (clamped to >= 1s, <= 30s) while the row stays pending", async () => {
        const now = () => new Date("2026-10-08T12:00:00.000Z").getTime();
        vi.mocked(getByIds).mockResolvedValueOnce([pendingRow]);
        vi.mocked(runDeliveryPass).mockImplementation(async () => {
            vi.mocked(getByIds).mockResolvedValueOnce([pendingRow]).mockResolvedValue([sentRow]);
        });
        const sleep = vi.fn(() => Promise.resolve());
        await expect(deliverBatchUntilTerminal([1], { sleep, now })).resolves.toBe("terminal");
        expect(sleep).toHaveBeenCalledWith(10_000);
    });

    it("gives up with budget_exceeded when the budget is exhausted", async () => {
        let t = 0;
        const now = () => { t += 3 * 60 * 1000; return t; }; // jumps past 4 min on 2nd call
        vi.mocked(getByIds).mockResolvedValue([pendingRow]);
        await expect(deliverBatchUntilTerminal([1], { sleep: instantSleep, now })).resolves.toBe("budget_exceeded");
    });
});
