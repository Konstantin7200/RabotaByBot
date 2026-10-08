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
    it("sends to the mailbox owner's chat, parsing the chat id", async () => {
        await notifyMailboxOwner(7, "hello");
        expect(sendMessage).toHaveBeenCalledWith(42, "hello");
    });
    it("does nothing when the mailbox has no chat", async () => {
        vi.mocked(getChatIdByMailboxId).mockResolvedValue(null);
        await notifyMailboxOwner(7, "hello");
        expect(sendMessage).not.toHaveBeenCalled();
    });
    it("swallows send failures (best-effort, never rejects)", async () => {
        vi.mocked(sendMessage).mockRejectedValue(new Error("blocked"));
        await expect(notifyMailboxOwner(7, "hello")).resolves.toBeUndefined();
    });
    it("swallows lookup failures", async () => {
        vi.mocked(getChatIdByMailboxId).mockRejectedValue(new Error("db down"));
        await expect(notifyMailboxOwner(7, "hello")).resolves.toBeUndefined();
    });
});
