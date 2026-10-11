import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/mailboxRepository", () => ({
    registerTransientFailure: vi.fn(),
    wasFailureNotified: vi.fn(),
    claimFailureNotice: vi.fn(),
    registerPipelineSuccess: vi.fn(),
    consumeFailureNotice: vi.fn(),
}));
vi.mock("./notifyMailboxOwner", () => ({ notifyMailboxOwner: vi.fn() }));

import { reportPipelineSuccess, reportTransientFailure } from "./failureNotice";
import { claimFailureNotice, consumeFailureNotice, registerPipelineSuccess, registerTransientFailure, wasFailureNotified } from "../db/mailboxRepository";
import { notifyMailboxOwner } from "./notifyMailboxOwner";
import { MESSAGE_DELIVERY_RESTORED, MESSAGE_PERSISTENT_FAILURE, PERSISTENT_FAILURE_THRESHOLD } from "../constants";

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(registerTransientFailure).mockResolvedValue(1);
    vi.mocked(wasFailureNotified).mockResolvedValue(false);
    vi.mocked(claimFailureNotice).mockResolvedValue(true);
    vi.mocked(registerPipelineSuccess).mockResolvedValue(false);
    vi.mocked(consumeFailureNotice).mockResolvedValue(undefined);
    vi.mocked(notifyMailboxOwner).mockResolvedValue(true);
});

describe("reportTransientFailure (US-9, M5 claim-after-send)", () => {
    it("stays silent below the persistence threshold", async () => {
        vi.mocked(registerTransientFailure).mockResolvedValue(PERSISTENT_FAILURE_THRESHOLD - 1);
        await reportTransientFailure(7, "a@b.c");
        expect(wasFailureNotified).not.toHaveBeenCalled();
        expect(notifyMailboxOwner).not.toHaveBeenCalled();
        expect(claimFailureNotice).not.toHaveBeenCalled();
    });

    it("notifies exactly once when the threshold is reached", async () => {
        vi.mocked(registerTransientFailure).mockResolvedValue(PERSISTENT_FAILURE_THRESHOLD);
        await reportTransientFailure(7, "a@b.c");
        expect(notifyMailboxOwner).toHaveBeenCalledWith(7, MESSAGE_PERSISTENT_FAILURE("a@b.c"));
        // M5: the claim is taken only after the send succeeded
        expect(vi.mocked(notifyMailboxOwner).mock.invocationCallOrder[0])
            .toBeLessThan(vi.mocked(claimFailureNotice).mock.invocationCallOrder[0]);
        expect(claimFailureNotice).toHaveBeenCalledWith(7);
    });

    it("does not notify again when the notice was already claimed", async () => {
        vi.mocked(registerTransientFailure).mockResolvedValue(PERSISTENT_FAILURE_THRESHOLD + 1);
        vi.mocked(wasFailureNotified).mockResolvedValue(true);
        await reportTransientFailure(7, "a@b.c");
        expect(notifyMailboxOwner).not.toHaveBeenCalled();
        expect(claimFailureNotice).not.toHaveBeenCalled();
    });

    it("does not consume the claim when the send fails (M5)", async () => {
        vi.mocked(registerTransientFailure).mockResolvedValue(PERSISTENT_FAILURE_THRESHOLD);
        vi.mocked(notifyMailboxOwner).mockResolvedValue(false);
        await reportTransientFailure(7, "a@b.c");
        expect(claimFailureNotice).not.toHaveBeenCalled();
    });
});

describe("reportPipelineSuccess (US-10, M5 claim-after-send)", () => {
    it("stays silent when no failure notice was ever sent", async () => {
        await reportPipelineSuccess(7, "a@b.c");
        expect(notifyMailboxOwner).not.toHaveBeenCalled();
        expect(consumeFailureNotice).not.toHaveBeenCalled();
    });

    it("sends the restore message to previously notified owners and then consumes the claim", async () => {
        vi.mocked(registerPipelineSuccess).mockResolvedValue(true);
        await reportPipelineSuccess(7, "a@b.c");
        expect(notifyMailboxOwner).toHaveBeenCalledWith(7, MESSAGE_DELIVERY_RESTORED("a@b.c"));
        expect(vi.mocked(notifyMailboxOwner).mock.invocationCallOrder[0])
            .toBeLessThan(vi.mocked(consumeFailureNotice).mock.invocationCallOrder[0]);
        expect(consumeFailureNotice).toHaveBeenCalledWith(7);
    });

    it("keeps the claim when the restore notice cannot be delivered (M5)", async () => {
        vi.mocked(registerPipelineSuccess).mockResolvedValue(true);
        vi.mocked(notifyMailboxOwner).mockResolvedValue(false);
        await reportPipelineSuccess(7, "a@b.c");
        expect(consumeFailureNotice).not.toHaveBeenCalled();
    });
});
