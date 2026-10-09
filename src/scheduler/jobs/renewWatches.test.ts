import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/mailboxRepository", () => ({
    listDueForRenewal: vi.fn(),
    setAccessFailure: vi.fn(),
    registerTransientFailure: vi.fn(),
    claimFailureNotice: vi.fn(),
    registerPipelineSuccess: vi.fn(),
}));
vi.mock("../../bot/notifyMailboxOwner", () => ({ notifyMailboxOwner: vi.fn() }));
vi.mock("../../gmail/watch", () => ({ watch: vi.fn() }));

import { renewWatches } from "./renewWatches";
import {
    claimFailureNotice,
    listDueForRenewal,
    registerPipelineSuccess,
    registerTransientFailure,
    setAccessFailure,
} from "../../db/mailboxRepository";
import { notifyMailboxOwner } from "../../bot/notifyMailboxOwner";
import { watch } from "../../gmail/watch";
import { MESSAGE_DELIVERY_RESTORED, MESSAGE_PERSISTENT_FAILURE, MESSAGE_WATCH_EXPIRED, MESSAGE_WATCH_RENEW_ERROR, PERSISTENT_FAILURE_THRESHOLD, WATCH_RENEWAL_THRESHOLD_MS } from "../../constants";

const base = { id: 5, email: "u@b.c", refreshToken: "rt", watchExpiration: null as Date | null };
const gaxios = (props: { code?: number; message?: string }) => {
    const err = new Error(props.message ?? "boom") as Error & { code?: number };
    if (props.code !== undefined) err.code = props.code;
    return err;
};

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listDueForRenewal).mockResolvedValue([base as never]);
    vi.mocked(watch).mockResolvedValue({ historyId: "1", expiration: "e" } as never);
    vi.mocked(registerTransientFailure).mockResolvedValue(1);
    vi.mocked(claimFailureNotice).mockResolvedValue(true);
    vi.mocked(registerPipelineSuccess).mockResolvedValue(false);
});

describe("renewWatches", () => {
    it("queries due mailboxes with the 24h renewal threshold", async () => {
        await renewWatches();
        const threshold = vi.mocked(listDueForRenewal).mock.calls[0][0].getTime();
        expect(threshold).toBeGreaterThanOrEqual(Date.now() + WATCH_RENEWAL_THRESHOLD_MS - 1000);
    });

    it("renews a due watch without notifying", async () => {
        await renewWatches();
        expect(watch).toHaveBeenCalledWith("u@b.c", "rt");
        expect(setAccessFailure).not.toHaveBeenCalled();
        expect(notifyMailboxOwner).not.toHaveBeenCalled();
    });

    it("skips a mailbox without a refresh token", async () => {
        vi.mocked(listDueForRenewal).mockResolvedValue([{ ...base, refreshToken: null } as never]);
        await renewWatches();
        expect(watch).not.toHaveBeenCalled();
    });

    it("marks expired and notifies once when refresh fails with invalid_grant (FR-12 б)", async () => {
        vi.mocked(watch).mockRejectedValue(gaxios({ code: 400, message: "invalid_grant: Token has been expired or revoked." }));
        await renewWatches();
        expect(setAccessFailure).toHaveBeenCalledWith("u@b.c", "expired");
        expect(notifyMailboxOwner).toHaveBeenCalledWith(5, MESSAGE_WATCH_EXPIRED("u@b.c"));
        expect(notifyMailboxOwner).toHaveBeenCalledTimes(1);
    });

    it("stays silent on a transient error while the watch is still valid", async () => {
        vi.mocked(listDueForRenewal).mockResolvedValue([{ ...base, watchExpiration: new Date(Date.now() + 60_000) } as never]);
        vi.mocked(watch).mockRejectedValue(gaxios({ code: 503 }));
        await renewWatches();
        expect(setAccessFailure).not.toHaveBeenCalled();
        expect(notifyMailboxOwner).not.toHaveBeenCalled();
        expect(registerTransientFailure).toHaveBeenCalledWith(5);
    });

    it("notifies the owner once the transient failures are persistent (US-9)", async () => {
        vi.mocked(listDueForRenewal).mockResolvedValue([{ ...base, watchExpiration: new Date(Date.now() + 60_000) } as never]);
        vi.mocked(watch).mockRejectedValue(gaxios({ code: 503 }));
        vi.mocked(registerTransientFailure).mockResolvedValue(PERSISTENT_FAILURE_THRESHOLD);
        await renewWatches();
        expect(notifyMailboxOwner).toHaveBeenCalledWith(5, MESSAGE_PERSISTENT_FAILURE("u@b.c"));
        expect(setAccessFailure).not.toHaveBeenCalled();
    });

    it("sends the restore message after a successful renewal when a notice was sent (US-10)", async () => {
        vi.mocked(registerPipelineSuccess).mockResolvedValue(true);
        await renewWatches();
        expect(notifyMailboxOwner).toHaveBeenCalledWith(5, MESSAGE_DELIVERY_RESTORED("u@b.c"));
    });

    it("promotes a transient error to error and notifies when the watch is dead (FR-12 а)", async () => {
        vi.mocked(listDueForRenewal).mockResolvedValue([{ ...base, watchExpiration: new Date(Date.now() - 1000) } as never]);
        vi.mocked(watch).mockRejectedValue(gaxios({ code: 503 }));
        await renewWatches();
        expect(setAccessFailure).toHaveBeenCalledWith("u@b.c", "error");
        expect(notifyMailboxOwner).toHaveBeenCalledWith(5, MESSAGE_WATCH_RENEW_ERROR("u@b.c"));
    });

    it("marks error and notifies on a hard API failure regardless of watch expiry (FR-12 в)", async () => {
        vi.mocked(listDueForRenewal).mockResolvedValue([{ ...base, watchExpiration: new Date(Date.now() + 60_000) } as never]);
        vi.mocked(watch).mockRejectedValue(gaxios({ code: 403 }));
        await renewWatches();
        expect(setAccessFailure).toHaveBeenCalledWith("u@b.c", "error");
        expect(notifyMailboxOwner).toHaveBeenCalledWith(5, MESSAGE_WATCH_RENEW_ERROR("u@b.c"));
    });
});
