import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/userRepository", () => ({ getChatIdByMailboxId: vi.fn() }));
vi.mock("./sendMessage", () => ({ sendMessage: vi.fn() }));

import { notifyMailboxOwner } from "./notifyMailboxOwner";
import { getChatIdByMailboxId } from "../db/userRepository";
import { sendMessage } from "./sendMessage";

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getChatIdByMailboxId).mockResolvedValue("42");
    vi.mocked(sendMessage).mockResolvedValue(undefined as never);
});

describe("notifyMailboxOwner", () => {
    const opts = { sleep: async () => {} };
    it("sends to the mailbox owner's chat, parsing the chat id", async () => {
        await expect(notifyMailboxOwner(7, "hello")).resolves.toBe(true);
        expect(sendMessage).toHaveBeenCalledWith(42, "hello");
    });
    it("does nothing when the mailbox has no chat", async () => {
        vi.mocked(getChatIdByMailboxId).mockResolvedValue(null);
        await expect(notifyMailboxOwner(7, "hello")).resolves.toBe(false);
        expect(sendMessage).not.toHaveBeenCalled();
    });
    it("swallows send failures (best-effort, never rejects)", async () => {
        vi.mocked(sendMessage).mockRejectedValue(new Error("blocked"));
        await expect(notifyMailboxOwner(7, "hello", opts)).resolves.toBe(false);
    });
    it("swallows lookup failures", async () => {
        vi.mocked(getChatIdByMailboxId).mockRejectedValue(new Error("db down"));
        await expect(notifyMailboxOwner(7, "hello")).resolves.toBe(false);
    });
    it("retries a transient send failure before giving up (US-9)", async () => {
        const sleep = vi.fn().mockResolvedValue(undefined as never);
        vi.mocked(sendMessage).mockRejectedValueOnce(new Error("network"));
        await expect(notifyMailboxOwner(7, "hello", { sleep })).resolves.toBe(true);
        expect(sendMessage).toHaveBeenCalledTimes(2);
        expect(sleep).toHaveBeenCalledTimes(1);
    });
    it("does not retry a permanently blocked chat (403)", async () => {
        const sleep = vi.fn();
        vi.mocked(sendMessage).mockRejectedValue(
            Object.assign(new Error("Forbidden"), { error_code: 403 }));
        await expect(notifyMailboxOwner(7, "hello", { sleep })).resolves.toBe(false);
        expect(sendMessage).toHaveBeenCalledTimes(1);
        expect(sleep).not.toHaveBeenCalled();
    });
});
