import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/mailboxRepository", () => ({
    registerTransientFailure: vi.fn(),
    claimFailureNotice: vi.fn(),
    registerPipelineSuccess: vi.fn(),
}));
vi.mock("./notifyMailboxOwner", () => ({ notifyMailboxOwner: vi.fn() }));

import { reportPipelineSuccess, reportTransientFailure } from "./failureNotice";
import { claimFailureNotice, registerPipelineSuccess, registerTransientFailure } from "../db/mailboxRepository";
import { notifyMailboxOwner } from "./notifyMailboxOwner";
import { MESSAGE_DELIVERY_RESTORED, MESSAGE_PERSISTENT_FAILURE, PERSISTENT_FAILURE_THRESHOLD } from "../constants";

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(registerTransientFailure).mockResolvedValue(1);
    vi.mocked(claimFailureNotice).mockResolvedValue(true);
    vi.mocked(registerPipelineSuccess).mockResolvedValue(false);
});

describe("reportTransientFailure (US-9)", () => {
    it("stays silent below the persistence threshold", async () => {
        vi.mocked(registerTransientFailure).mockResolvedValue(PERSISTENT_FAILURE_THRESHOLD - 1);
        await reportTransientFailure(7, "a@b.c");
        expect(claimFailureNotice).not.toHaveBeenCalled();
        expect(notifyMailboxOwner).not.toHaveBeenCalled();
    });

    it("notifies exactly once when the threshold is reached", async () => {
        vi.mocked(registerTransientFailure).mockResolvedValue(PERSISTENT_FAILURE_THRESHOLD);
        await reportTransientFailure(7, "a@b.c");
        expect(claimFailureNotice).toHaveBeenCalledWith(7);
        expect(notifyMailboxOwner).toHaveBeenCalledWith(7, MESSAGE_PERSISTENT_FAILURE("a@b.c"));
    });

    it("does not notify again when the notice was already claimed", async () => {
        vi.mocked(registerTransientFailure).mockResolvedValue(PERSISTENT_FAILURE_THRESHOLD + 1);
        vi.mocked(claimFailureNotice).mockResolvedValue(false);
        await reportTransientFailure(7, "a@b.c");
        expect(notifyMailboxOwner).not.toHaveBeenCalled();
    });
});

describe("reportPipelineSuccess (US-10)", () => {
    it("stays silent when no failure notice was ever sent", async () => {
        await reportPipelineSuccess(7, "a@b.c");
        expect(notifyMailboxOwner).not.toHaveBeenCalled();
    });

    it("sends the restore message only to previously notified owners", async () => {
        vi.mocked(registerPipelineSuccess).mockResolvedValue(true);
        await reportPipelineSuccess(7, "a@b.c");
        expect(notifyMailboxOwner).toHaveBeenCalledWith(7, MESSAGE_DELIVERY_RESTORED("a@b.c"));
    });
});
