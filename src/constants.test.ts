import { describe, expect, it } from "vitest";
import {
    chooseLoginMessage,
    MESSAGE_ACCESS_RESTORED,
    MESSAGE_LOGIN_SUCCESS,
} from "./constants";

describe("chooseLoginMessage", () => {
    it("reports recovery when the mailbox had a failure status", () => {
        for (const status of ["expired", "revoked", "error"])
            expect(chooseLoginMessage("u@b.c", status)).toBe(MESSAGE_ACCESS_RESTORED("u@b.c"));
    });
    it("keeps the generic login message for healthy, unlinked, or new mailboxes", () => {
        for (const status of ["active", "unlinked", null])
            expect(chooseLoginMessage("u@b.c", status)).toBe(MESSAGE_LOGIN_SUCCESS);
    });
});
