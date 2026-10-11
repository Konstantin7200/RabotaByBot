import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/notificationRepository", () => ({ replayFailed: vi.fn() }));
vi.mock("../../db/mailboxRepository", () => ({ listActive: vi.fn() }));
vi.mock("../../gmail/catchUpMailbox", () => ({ catchUpMailbox: vi.fn() }));

import { runCatchUpPass } from "./catchUpPass";
import { replayFailed } from "../../db/notificationRepository";
import { listActive } from "../../db/mailboxRepository";
import { catchUpMailbox } from "../../gmail/catchUpMailbox";

const active = [
    { mailbox: { id: 1, email: "a@b.c" }, chatId: "42" },
    { mailbox: { id: 2, email: "d@e.f" }, chatId: "43" },
];

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(replayFailed).mockResolvedValue(0);
    vi.mocked(listActive).mockResolvedValue(active as never);
    vi.mocked(catchUpMailbox).mockResolvedValue({ outcome: "ok", source: "history", scanned: 0, inserted: 0, delivered: 0 });
});

describe("runCatchUpPass", () => {
    it("replays failed rows before scanning the first mailbox (FR-11 → FR-14)", async () => {
        await runCatchUpPass();
        expect(replayFailed).toHaveBeenCalledTimes(1);
        expect(catchUpMailbox).toHaveBeenCalledTimes(2);
        expect(vi.mocked(replayFailed).mock.invocationCallOrder[0])
            .toBeLessThan(vi.mocked(catchUpMailbox).mock.invocationCallOrder[0]);
    });

    it("keeps scanning the remaining mailboxes when one rejects", async () => {
        vi.mocked(catchUpMailbox).mockRejectedValueOnce(new Error("dead token"));
        await expect(runCatchUpPass()).resolves.toBeUndefined();
        expect(catchUpMailbox).toHaveBeenCalledTimes(2);
    });

    it("runs a single pass for concurrent callers (mutex)", async () => {
        let release!: () => void;
        vi.mocked(replayFailed).mockReturnValue(new Promise((r) => { release = () => r(0); }));
        const first = runCatchUpPass();
        const second = runCatchUpPass();
        release();
        await Promise.all([first, second]);
        expect(replayFailed).toHaveBeenCalledTimes(1);
    });

    it("re-arms the mutex after a rejected pass settles", async () => {
        vi.mocked(replayFailed).mockRejectedValueOnce(new Error("db down"));
        await expect(runCatchUpPass()).rejects.toThrow("db down");
        await runCatchUpPass();
        expect(replayFailed).toHaveBeenCalledTimes(2);
        expect(catchUpMailbox).toHaveBeenCalledTimes(2);
    });
});
