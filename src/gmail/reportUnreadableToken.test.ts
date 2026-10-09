import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/mailboxRepository", () => ({ setAccessFailure: vi.fn() }));
vi.mock("../bot/notifyMailboxOwner", () => ({ notifyMailboxOwner: vi.fn() }));

import { reportUnreadableToken } from "./reportUnreadableToken";
import { setAccessFailure } from "../db/mailboxRepository";
import { notifyMailboxOwner } from "../bot/notifyMailboxOwner";
import { MESSAGE_WATCH_EXPIRED } from "../constants";

const active = { id: 7, email: "a@b.c", accessStatus: "active" } as never;

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(setAccessFailure).mockResolvedValue(undefined as never);
    vi.mocked(notifyMailboxOwner).mockResolvedValue(true);
});

describe("reportUnreadableToken (WP4 fresh start)", () => {
    it("marks access lost and tells the owner to re-link", async () => {
        await reportUnreadableToken(active);
        expect(setAccessFailure).toHaveBeenCalledWith("a@b.c", "expired");
        expect(notifyMailboxOwner).toHaveBeenCalledWith(7, MESSAGE_WATCH_EXPIRED("a@b.c"));
    });

    it("stays silent for mailboxes that are not active", async () => {
        await reportUnreadableToken({ id: 7, email: "a@b.c", accessStatus: "unlinked" } as never);
        await reportUnreadableToken({ id: 7, email: "a@b.c", accessStatus: "expired" } as never);
        expect(setAccessFailure).not.toHaveBeenCalled();
        expect(notifyMailboxOwner).not.toHaveBeenCalled();
    });
});
