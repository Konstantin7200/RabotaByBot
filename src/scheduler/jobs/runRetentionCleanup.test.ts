import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/notificationRepository", () => ({ cleanupOlderThan: vi.fn() }));

import { runRetentionCleanup } from "./runRetentionCleanup";
import { cleanupOlderThan } from "../../db/notificationRepository";
import { RETENTION_DAYS } from "../../constants";

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cleanupOlderThan).mockResolvedValue(0);
});

describe("runRetentionCleanup (WP16)", () => {
    it("deletes delivered notifications older than the retention window", async () => {
        const now = new Date("2026-10-10T04:00:00.000Z");
        await runRetentionCleanup(now);
        const cutoff = vi.mocked(cleanupOlderThan).mock.calls[0][0];
        expect(cutoff.getTime()).toBe(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    });

    it("returns the number of removed rows", async () => {
        vi.mocked(cleanupOlderThan).mockResolvedValue(12);
        await expect(runRetentionCleanup()).resolves.toBe(12);
    });
});
