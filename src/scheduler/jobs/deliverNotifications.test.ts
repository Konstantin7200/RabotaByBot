import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/notificationRepository", () => ({
    markStaleAsSent: vi.fn(), claimDueRetries: vi.fn(),
}));
vi.mock("../../bot/deliverNotification", () => ({ deliverNotification: vi.fn() }));

import { runDeliveryPass, sweepStaleOnBoot } from "./deliverNotifications";
import { claimDueRetries, markStaleAsSent } from "../../db/notificationRepository";
import { deliverNotification } from "../../bot/deliverNotification";

const rowA = { id: 1 } as never;
const rowB = { id: 2 } as never;

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(markStaleAsSent).mockResolvedValue(0);
    vi.mocked(claimDueRetries).mockResolvedValue([]);
});

describe("runDeliveryPass", () => {
    it("delivers every claimed row without ever sweeping stale rows (FR-7 recovery-time rule)", async () => {
        vi.mocked(claimDueRetries).mockResolvedValue([rowA, rowB]);
        await runDeliveryPass();
        expect(markStaleAsSent).not.toHaveBeenCalled();
        expect(vi.mocked(deliverNotification).mock.calls.map((c) => c[0])).toEqual([rowA, rowB]);
    });

    it("does nothing when nothing is due", async () => {
        await runDeliveryPass();
        expect(deliverNotification).not.toHaveBeenCalled();
    });

    it("keeps delivering the remaining rows when one attempt throws", async () => {
        vi.mocked(claimDueRetries).mockResolvedValue([rowA, rowB]);
        vi.mocked(deliverNotification).mockRejectedValueOnce(new Error("db down"));
        await runDeliveryPass();
        expect(deliverNotification).toHaveBeenCalledTimes(2);
    });

    it("runs a single pass for concurrent callers (mutex)", async () => {
        let release!: () => void;
        vi.mocked(claimDueRetries).mockReturnValue(new Promise((r) => { release = () => r([]); }));
        const first = runDeliveryPass();
        const second = runDeliveryPass();
        release();
        await Promise.all([first, second]);
        expect(claimDueRetries).toHaveBeenCalledTimes(1);
    });

    it("re-arms the mutex after a rejected pass settles", async () => {
        vi.mocked(claimDueRetries).mockRejectedValueOnce(new Error("db down"));
        await expect(runDeliveryPass()).rejects.toThrow("db down");
        await runDeliveryPass();
        expect(claimDueRetries).toHaveBeenCalledTimes(2);
        expect(markStaleAsSent).not.toHaveBeenCalled();
    });
});

describe("sweepStaleOnBoot (FR-7)", () => {
    it("treats pending rows older than the window as delivered, once per boot", async () => {
        vi.mocked(markStaleAsSent).mockResolvedValue(3);
        await sweepStaleOnBoot();
        expect(markStaleAsSent).toHaveBeenCalledTimes(1);
    });

    it("swallows sweep failures so boot cannot be blocked", async () => {
        vi.mocked(markStaleAsSent).mockRejectedValue(new Error("db down"));
        await expect(sweepStaleOnBoot()).resolves.toBeUndefined();
    });
});
