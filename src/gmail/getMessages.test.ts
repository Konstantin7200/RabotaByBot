import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../config", () => ({
    EnvConfig: { rabotaSubjectPatterns: [] as string[] },
}));
vi.mock("./messageBody", () => ({ messageBodyToText: vi.fn(() => "text") }));
vi.mock("./parseMessageFields", () => ({
    parseMessageFields: vi.fn(() => ({ vacancy: null, employer: null, outcome: null })),
}));

import { getDataFromMessages } from "./getMessages";

const RABOTA_METADATA = {
    data: {
        payload: {
            headers: [
                { name: "From", value: "Rabota.by <noreply@rabota.by>" },
                { name: "Subject", value: "Ответ на отклик" },
            ],
        },
    },
};
const notFound = Object.assign(new Error("not found"), { response: { status: 404 } });
const rateLimited = Object.assign(new Error("rate limited"), {
    response: { status: 403, data: { error: { errors: [{ reason: "rateLimitExceeded" }] } } },
});
const serverError = Object.assign(new Error("backendError"), { code: 503 });

function gmailWith(get: (id: string, format: string) => Promise<unknown>) {
    return {
        users: {
            messages: {
                get: vi.fn(async ({ id, format }: { id: string; format: string }) => get(id, format)),
            },
        },
    };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe("getDataFromMessages — skip rules (FR-7 / M1)", () => {
    it("skips messages that 404 in the metadata pass and keeps the rest", async () => {
        const gmail = gmailWith((id) => {
            if (id === "gone")
                return Promise.reject(notFound);
            return Promise.resolve(RABOTA_METADATA);
        });
        const result = await getDataFromMessages(gmail as never, ["gone", "m2"], "a@b.c");
        expect(result.map((m) => m.gmailMessageId)).toEqual(["m2"]);
    });

    it("skips messages that 404 in the full-fetch pass", async () => {
        const gmail = gmailWith((id, format) => {
            if (format === "full" && id === "m1")
                return Promise.reject(notFound);
            return Promise.resolve(RABOTA_METADATA);
        });
        const result = await getDataFromMessages(gmail as never, ["m1"], "a@b.c");
        expect(result).toEqual([]);
    });

    it("propagates a transient 403 rate-limit so the whole batch is retried", async () => {
        const gmail = gmailWith(() => Promise.reject(rateLimited));
        await expect(getDataFromMessages(gmail as never, ["m1"], "a@b.c")).rejects.toThrow("rate limited");
    });

    it("propagates a 5xx so the whole batch is retried", async () => {
        const gmail = gmailWith(() => Promise.reject(serverError));
        await expect(getDataFromMessages(gmail as never, ["m1"], "a@b.c")).rejects.toThrow("backendError");
    });
});
