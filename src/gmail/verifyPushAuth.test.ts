import { describe, expect, it } from "vitest";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { verifyPushAuth } from "./verifyPushAuth";

const AUDIENCE = "https://bot.example/gmail/notification";
const ISSUER = "https://accounts.google.com";

async function fixture() {
    const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
    const jwk = await exportJWK(publicKey);
    const getKey = createLocalJWKSet({ keys: [{ ...jwk, alg: "ES256", kid: "test-key" }] });
    const sign = (o?: { iss?: string; aud?: string; expSeconds?: number }) =>
        new SignJWT({})
            .setProtectedHeader({ alg: "ES256", kid: "test-key" })
            .setIssuer(o?.iss ?? ISSUER)
            .setAudience(o?.aud ?? AUDIENCE)
            .setIssuedAt()
            .setExpirationTime(Math.floor(Date.now() / 1000) + (o?.expSeconds ?? 300))
            .sign(privateKey);
    return { getKey, sign };
}

describe("verifyPushAuth", () => {
    it("accepts a valid Google-signed JWT", async () => {
        const { getKey, sign } = await fixture();
        expect(await verifyPushAuth(`Bearer ${await sign()}`, AUDIENCE, getKey)).toBe(true);
    });
    it("accepts the bare accounts.google.com issuer form", async () => {
        const { getKey, sign } = await fixture();
        expect(await verifyPushAuth(`Bearer ${await sign({ iss: "accounts.google.com" })}`, AUDIENCE, getKey)).toBe(true);
    });
    it("rejects a missing or non-Bearer header", async () => {
        const { getKey } = await fixture();
        expect(await verifyPushAuth(undefined, AUDIENCE, getKey)).toBe(false);
        expect(await verifyPushAuth("Basic dXNlcjpwdw==", AUDIENCE, getKey)).toBe(false);
    });
    it("rejects a mismatched audience", async () => {
        const { getKey, sign } = await fixture();
        expect(await verifyPushAuth(`Bearer ${await sign({ aud: "https://evil.example/gmail/notification" })}`, AUDIENCE, getKey)).toBe(false);
    });
    it("rejects a foreign issuer", async () => {
        const { getKey, sign } = await fixture();
        expect(await verifyPushAuth(`Bearer ${await sign({ iss: "https://issuer.example" })}`, AUDIENCE, getKey)).toBe(false);
    });
    it("rejects an expired token", async () => {
        const { getKey, sign } = await fixture();
        expect(await verifyPushAuth(`Bearer ${await sign({ expSeconds: -60 })}`, AUDIENCE, getKey)).toBe(false);
    });
});
