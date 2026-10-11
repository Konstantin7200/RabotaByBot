import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/appStateRepository", () => ({ touchHeartbeat: vi.fn() }));

import { heartbeat } from "./heartbeat";
import { touchHeartbeat } from "../../db/appStateRepository";

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(touchHeartbeat).mockResolvedValue(undefined as never);
});

describe("heartbeat", () => {
    it("records the current time as the heartbeat", async () => {
        await heartbeat();
        expect(touchHeartbeat).toHaveBeenCalledTimes(1);
        expect(vi.mocked(touchHeartbeat).mock.calls[0][0]).toBeInstanceOf(Date);
    });
});
