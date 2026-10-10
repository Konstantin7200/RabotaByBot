import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/mailboxRepository", () => ({ unlinkMailbox: vi.fn() }));
vi.mock("./stopWatching", () => ({ stopWatching: vi.fn() }));
vi.mock("./revokeToken", () => ({ revokeToken: vi.fn() }));

import { untrackMailbox } from "./untrackMailbox";
import { unlinkMailbox } from "../db/mailboxRepository";
import { stopWatching } from "./stopWatching";
import { revokeToken } from "./revokeToken";

const mailbox = {
    id: 7, email: "a@b.c", refreshToken: "rt", userId: 3,
} as never;

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(stopWatching).mockResolvedValue(undefined as never);
    vi.mocked(revokeToken).mockResolvedValue(undefined as never);
    vi.mocked(unlinkMailbox).mockResolvedValue(undefined as never);
});

describe("untrackMailbox (FR-9)", () => {
    it("reports a complete unlink when stop and revoke both succeed", async () => {
        await expect(untrackMailbox(mailbox)).resolves.toEqual({ stopped: true, revoked: true });
        expect(unlinkMailbox).toHaveBeenCalledWith(3);
    });

    it("reports an incomplete unlink when stopping the watch fails", async () => {
        vi.mocked(stopWatching).mockRejectedValue(new Error("backendError"));
        await expect(untrackMailbox(mailbox)).resolves.toEqual({ stopped: false, revoked: true });
        expect(revokeToken).toHaveBeenCalledWith("rt");
        expect(unlinkMailbox).toHaveBeenCalledWith(3);
    });

    it("still stops the watch when revoking fails", async () => {
        vi.mocked(revokeToken).mockRejectedValue(new Error("backendError"));
        await expect(untrackMailbox(mailbox)).resolves.toEqual({ stopped: true, revoked: false });
        expect(stopWatching).toHaveBeenCalledWith("a@b.c", "rt");
        expect(unlinkMailbox).toHaveBeenCalledWith(3);
    });

    it("unlinks the mailbox locally even when the token is unreadable", async () => {
        await expect(untrackMailbox({ id: 7, email: "a@b.c", refreshToken: null, userId: 3 } as never))
            .resolves.toEqual({ stopped: false, revoked: false });
        expect(stopWatching).not.toHaveBeenCalled();
        expect(revokeToken).not.toHaveBeenCalled();
        expect(unlinkMailbox).toHaveBeenCalledWith(3);
    });

    it("still unlinks the mailbox locally when userId is missing", async () => {
        await expect(untrackMailbox({ id: 7, email: "a@b.c", refreshToken: null, userId: null } as never))
            .resolves.toEqual({ stopped: false, revoked: false });
        expect(unlinkMailbox).not.toHaveBeenCalled();
    });
});
