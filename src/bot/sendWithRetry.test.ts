import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./sendMessage", () => ({ sendMessage: vi.fn() }));

import { sendWithRetry } from "./sendWithRetry";
import { sendMessage } from "./sendMessage";

const sleep = vi.fn().mockResolvedValue(undefined as never);

beforeEach(() => {
    vi.clearAllMocks();
    sleep.mockResolvedValue(undefined as never);
    vi.mocked(sendMessage).mockResolvedValue(undefined as never);
});

describe("sendWithRetry (US-9/US-10 notices)", () => {
    it("sends on the first attempt without sleeping", async () => {
        await sendWithRetry(42, "hello", { sleep });
        expect(sendMessage).toHaveBeenCalledTimes(1);
        expect(sleep).not.toHaveBeenCalled();
    });

    it("retries a transient failure with growing delay and succeeds", async () => {
        vi.mocked(sendMessage).mockRejectedValueOnce(new Error("network"));
        await sendWithRetry(42, "hello", { sleep });
        expect(sendMessage).toHaveBeenCalledTimes(2);
        expect(sleep).toHaveBeenCalledTimes(1);
        expect(sleep).toHaveBeenCalledWith(1_000);
    });

    it("gives up after the configured attempts and rethrows the last error", async () => {
        vi.mocked(sendMessage).mockRejectedValue(new Error("down"));
        await expect(sendWithRetry(42, "hello", { attempts: 3, sleep })).rejects.toThrow("down");
        expect(sendMessage).toHaveBeenCalledTimes(3);
        expect(sleep).toHaveBeenCalledTimes(2);
    });

    it("does not retry a permanently blocked chat (403)", async () => {
        vi.mocked(sendMessage).mockRejectedValue(
            Object.assign(new Error("Forbidden"), { error_code: 403 }));
        await expect(sendWithRetry(42, "hello", { sleep })).rejects.toThrow("Forbidden");
        expect(sendMessage).toHaveBeenCalledTimes(1);
        expect(sleep).not.toHaveBeenCalled();
    });
});
