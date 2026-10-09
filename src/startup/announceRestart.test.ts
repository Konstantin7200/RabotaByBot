import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/appStateRepository", () => ({ getHeartbeat: vi.fn(), touchHeartbeat: vi.fn() }));
vi.mock("../db/mailboxRepository", () => ({ listActive: vi.fn() }));
vi.mock("../bot/sendMessage", () => ({ sendMessage: vi.fn() }));

import { announceRestart } from "./announceRestart";
import { getHeartbeat, touchHeartbeat } from "../db/appStateRepository";
import { listActive } from "../db/mailboxRepository";
import { sendMessage } from "../bot/sendMessage";
import { DOWNTIME_THRESHOLD_MS, MESSAGE_BACK_ONLINE } from "../constants";

const now = new Date("2026-10-09T12:00:00.000Z");
const active = [
    { mailbox: { id: 1, email: "a@b.c" }, chatId: "42" },
    { mailbox: { id: 2, email: "d@e.f" }, chatId: "43" },
];

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sendMessage).mockResolvedValue(undefined as never);
    vi.mocked(touchHeartbeat).mockResolvedValue(undefined as never);
});

describe("announceRestart", () => {
    it("notifies every active chat when no heartbeat exists yet", async () => {
        vi.mocked(getHeartbeat).mockResolvedValue(null);
        vi.mocked(listActive).mockResolvedValue(active as never);
        await expect(announceRestart(now)).resolves.toBe(true);
        expect(sendMessage).toHaveBeenCalledTimes(2);
        expect(sendMessage).toHaveBeenCalledWith(42, MESSAGE_BACK_ONLINE);
        expect(sendMessage).toHaveBeenCalledWith(43, MESSAGE_BACK_ONLINE);
        expect(touchHeartbeat).toHaveBeenCalledWith(now);
    });

    it("notifies when the last heartbeat is older than the downtime threshold", async () => {
        vi.mocked(getHeartbeat).mockResolvedValue(new Date(now.getTime() - DOWNTIME_THRESHOLD_MS - 1));
        vi.mocked(listActive).mockResolvedValue(active as never);
        await announceRestart(now);
        expect(sendMessage).toHaveBeenCalledTimes(2);
        expect(touchHeartbeat).toHaveBeenCalledWith(now);
    });

    it("stays silent on a routine restart with a fresh heartbeat", async () => {
        vi.mocked(getHeartbeat).mockResolvedValue(new Date(now.getTime() - DOWNTIME_THRESHOLD_MS + 1));
        vi.mocked(listActive).mockResolvedValue(active as never);
        await expect(announceRestart(now)).resolves.toBe(false);
        expect(listActive).not.toHaveBeenCalled();
        expect(sendMessage).not.toHaveBeenCalled();
        expect(touchHeartbeat).toHaveBeenCalledWith(now);
    });

    it("just refreshes the heartbeat when no mailbox is active", async () => {
        vi.mocked(getHeartbeat).mockResolvedValue(null);
        vi.mocked(listActive).mockResolvedValue([] as never);
        await announceRestart(now);
        expect(sendMessage).not.toHaveBeenCalled();
        expect(touchHeartbeat).toHaveBeenCalledWith(now);
    });

    it("keeps going when a chat send fails (best-effort)", async () => {
        vi.mocked(getHeartbeat).mockResolvedValue(null);
        vi.mocked(listActive).mockResolvedValue(active as never);
        vi.mocked(sendMessage).mockRejectedValue(new Error("blocked"));
        await expect(announceRestart(now)).resolves.toBe(true);
        expect(sendMessage).toHaveBeenCalledTimes(2);
        expect(touchHeartbeat).toHaveBeenCalledWith(now);
    });
});
