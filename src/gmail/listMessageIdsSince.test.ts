import { describe, expect, it, vi } from "vitest";
import { listMessageIdsSince } from "./listMessageIdsSince";

function makeGmail(pages: { messages?: { id: string }[]; nextPageToken?: string }[]) {
    const list = vi.fn()
        .mockImplementationOnce(async () => ({ data: pages[0] }))
        .mockImplementationOnce(async () => ({ data: pages[1] }));
    return { gmail: { users: { messages: { list } } } as never, list };
}

describe("listMessageIdsSince", () => {
    it("queries with the sender filter, the date bound, and spam included", async () => {
        const { gmail, list } = makeGmail([{ messages: [{ id: "m1" }] }]);
        await expect(listMessageIdsSince(gmail, "a@b.c", 1791446399)).resolves.toEqual(["m1"]);
        expect(list).toHaveBeenCalledWith({
            userId: "a@b.c",
            q: "from:rabota.by after:1791446399",
            includeSpamTrash: true,
            maxResults: 100,
            pageToken: undefined,
        });
    });

    it("follows nextPageToken to exhaustion", async () => {
        const { gmail, list } = makeGmail([
            { messages: [{ id: "m1" }], nextPageToken: "t1" },
            { messages: [{ id: "m2" }] },
        ]);
        await expect(listMessageIdsSince(gmail, "a@b.c", 1)).resolves.toEqual(["m1", "m2"]);
        expect(list).toHaveBeenCalledTimes(2);
        expect(list.mock.calls[1][0]).toMatchObject({ pageToken: "t1" });
    });

    it("deduplicates ids repeated across pages", async () => {
        const { gmail } = makeGmail([
            { messages: [{ id: "m1" }], nextPageToken: "t1" },
            { messages: [{ id: "m1" }] },
        ]);
        await expect(listMessageIdsSince(gmail, "a@b.c", 1)).resolves.toEqual(["m1"]);
    });

    it("throws when a page repeats its nextPageToken", async () => {
        const { gmail } = makeGmail([
            { messages: [{ id: "m1" }], nextPageToken: "t1" },
            { messages: [{ id: "m2" }], nextPageToken: "t1" },
        ]);
        await expect(listMessageIdsSince(gmail, "a@b.c", 1)).rejects.toThrow("Repeated messages page token");
    });

    it("returns an empty list when nothing matches", async () => {
        const { gmail } = makeGmail([{ messages: [] }]);
        await expect(listMessageIdsSince(gmail, "a@b.c", 1)).resolves.toEqual([]);
    });
});
