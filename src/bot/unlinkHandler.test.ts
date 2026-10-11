import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/mailboxRepository", () => ({ getByUserId: vi.fn() }));
vi.mock("../db/userRepository", () => ({ getByChatId: vi.fn() }));
vi.mock("../gmail/untrackMailbox", () => ({ untrackMailbox: vi.fn() }));

import { unlinkHandler } from "./unlinkHandler";
import { getByUserId } from "../db/mailboxRepository";
import { getByChatId } from "../db/userRepository";
import { untrackMailbox } from "../gmail/untrackMailbox";
import { MESSAGE_FOR_UNLINK_CONFIRMATION, MESSAGE_FOR_UNLINK_INCOMPLETE, REVOKED_SCOPES } from "../constants";

const ctx = () => ({ chatId: 42, reply: vi.fn().mockResolvedValue(undefined) });
const mailbox = { id: 7, email: "a@b.c", refreshToken: "rt", userId: 3 } as never;

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getByChatId).mockResolvedValue({ id: 3, chatId: "42" } as never);
    vi.mocked(getByUserId).mockResolvedValue(mailbox);
    vi.mocked(untrackMailbox).mockResolvedValue({ stopped: true, revoked: true });
});

describe("unlinkHandler (FR-9)", () => {
    it("confirms a fully completed unlink", async () => {
        const context = ctx();
        await unlinkHandler(context as never);
        expect(context.reply).toHaveBeenCalledWith(MESSAGE_FOR_UNLINK_CONFIRMATION("a@b.c", REVOKED_SCOPES));
    });

    it("reports honestly when Google-side cleanup failed", async () => {
        vi.mocked(untrackMailbox).mockResolvedValue({ stopped: false, revoked: false });
        const context = ctx();
        await unlinkHandler(context as never);
        expect(context.reply).toHaveBeenCalledWith(
            MESSAGE_FOR_UNLINK_INCOMPLETE("a@b.c", "watch could not be stopped, access could not be revoked"),
        );
    });
});
