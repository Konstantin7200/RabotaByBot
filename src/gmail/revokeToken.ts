import { auth } from "../auth";

export async function revokeToken(refreshToken:string) {
    await auth.revokeToken(refreshToken);
}