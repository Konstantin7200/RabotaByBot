import { JWTVerifyGetKey, jwtVerify } from "jose";

const BEARER_PREFIX = "Bearer ";
export const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export async function verifyPushAuth(
    authorization: string | undefined,
    audience: string,
    getKey: JWTVerifyGetKey,
): Promise<boolean> {
    if (typeof authorization !== "string" || !authorization.startsWith(BEARER_PREFIX))
        return false;
    try {
        await jwtVerify(authorization.slice(BEARER_PREFIX.length), getKey, { issuer: GOOGLE_ISSUERS, audience });
        return true;
    } catch (err) {
        console.log({ event: "push_auth_verify_failed", err: String(err) });
        return false;
    }
}
