import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import type { KeyLike } from "jose";
import { derivePushAudience, createRequirePushAuth } from "./pushAuth";

const AUDIENCE = "https://bot.example/gmail/notification";

function makeRes() {
    const res = { status: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res);
    res.json.mockReturnValue(res);
    return res;
}

let getKey: ReturnType<typeof createLocalJWKSet>;
let privateKey: KeyLike;

beforeEach(async () => {
    const pair = await generateKeyPair("ES256", { extractable: true });
    privateKey = pair.privateKey;
    const jwk = await exportJWK(pair.publicKey);
    getKey = createLocalJWKSet({ keys: [{ ...jwk, alg: "ES256", kid: "k" }] });
});

describe("derivePushAudience", () => {
    it("replaces the redirect path with the push endpoint path", () => {
        expect(derivePushAudience("https://bot.up.railway.app/oauth/callback"))
            .toBe("https://bot.up.railway.app/gmail/notification");
    });
});

describe("createRequirePushAuth", () => {
    it("responds 401 when the header is missing", async () => {
        const mw = createRequirePushAuth(getKey, AUDIENCE);
        const res = makeRes();
        await mw({ headers: {} } as never, res as never, vi.fn() as never);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: "Unauthorized" });
    });
    it("calls next() for a valid token", async () => {
        const token = await new SignJWT({})
            .setProtectedHeader({ alg: "ES256", kid: "k" })
            .setIssuer("https://accounts.google.com")
            .setAudience(AUDIENCE)
            .setExpirationTime(Math.floor(Date.now() / 1000) + 300)
            .sign(privateKey);
        const mw = createRequirePushAuth(getKey, AUDIENCE);
        const next = vi.fn();
        await mw({ headers: { authorization: `Bearer ${token}` } } as never, makeRes() as never, next);
        expect(next).toHaveBeenCalledTimes(1);
    });
});
