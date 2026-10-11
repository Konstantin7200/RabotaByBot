import { describe, expect, it } from "vitest";
import { isFromRabotaBy } from "./isFromRabotaBy";

describe("isFromRabotaBy", () => {
    it.each([
        "rabota.by <noreply@rabota.by>",
        "noreply@rabota.by",
        "Noreply@RabOTA.by",
        "Rabota.by <support@rabota.by>",
        "=?UTF-8?B?0KTQvtCz0LjRjyA=?= <noreply@rabota.by>",
        "Работа <noreply@rabota.by>",
        "noreply@rabota.by, no-reply@rabota.by"
    ])("accepts genuine rabota.by sender: %s", value => {
        expect(isFromRabotaBy(value)).toBe(true);
    });

    it.each([
        "\"Rabota.by\" <attacker@evil.com>",
        "rabota.by <noreply@rabota.by>, evil <x@evil.com>",
        "noreply@rabota.by.evil.com",
        "noreply@[1.2.3.4]",
        "garbage value",
        ""
    ])("rejects spoofed or invalid sender: %s", value => {
        expect(isFromRabotaBy(value)).toBe(false);
    });
});
