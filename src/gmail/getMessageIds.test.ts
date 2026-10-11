import { describe, expect, it, vi } from "vitest";
import { getMessageIds } from "./getMessageIds";

type Page = { history?: unknown[]; nextPageToken?: string; historyId?: string };

function makeGmail(pages: Page[]) {
    const list = vi.fn()
        .mockImplementationOnce(async () => ({ data: pages[0] }))
        .mockImplementationOnce(async () => ({ data: pages[1] }));
    return { gmail: { users: { history: { list } } } as never, list };
}

const added = (...ids: string[]) => ids.map((id) => ({ messagesAdded: [{ message: { id } }] }));

describe("getMessageIds", () => {
    it("returns ids and historyId from a single page (existing behavior)", async () => {
        const { gmail } = makeGmail([{ history: added("m1", "m2"), historyId: "101" }]);
        await expect(getMessageIds(gmail, "u@b.c", "100"))
            .resolves.toEqual({ messageIds: ["m1", "m2"], newHistoryId: "101" });
    });

    it("follows nextPageToken and uses the final page's historyId", async () => {
        const { gmail, list } = makeGmail([
            { history: added("m1"), nextPageToken: "t1", historyId: "101" },
            { history: added("m2", "m3"), historyId: "102" },
        ]);
        await expect(getMessageIds(gmail, "u@b.c", "100"))
            .resolves.toEqual({ messageIds: ["m1", "m2", "m3"], newHistoryId: "102" });
        expect(list).toHaveBeenCalledTimes(2);
        expect(list.mock.calls[1][0]).toMatchObject({ pageToken: "t1" });
    });

    it("deduplicates ids repeated across pages", async () => {
        const { gmail } = makeGmail([
            { history: added("m1"), nextPageToken: "t1", historyId: "101" },
            { history: added("m1"), historyId: "102" },
        ]);
        await expect(getMessageIds(gmail, "u@b.c", "100"))
            .resolves.toEqual({ messageIds: ["m1"], newHistoryId: "102" });
    });

    it("throws when no historyId was ever returned", async () => {
        const { gmail } = makeGmail([{ history: [] }]);
        await expect(getMessageIds(gmail, "u@b.c", "100")).rejects.toThrow("No new history id provided");
    });

    it("throws when a page repeats its nextPageToken", async () => {
        const { gmail } = makeGmail([
            { history: added("m1"), nextPageToken: "t1", historyId: "101" },
            { history: added("m2"), nextPageToken: "t1", historyId: "102" },
        ]);
        await expect(getMessageIds(gmail, "u@b.c", "100")).rejects.toThrow("Repeated history page token");
    });

    it("returns an empty id list when nothing was added", async () => {
        const { gmail } = makeGmail([{ history: [], historyId: "101" }]);
        await expect(getMessageIds(gmail, "u@b.c", "100"))
            .resolves.toEqual({ messageIds: [], newHistoryId: "101" });
    });
});
