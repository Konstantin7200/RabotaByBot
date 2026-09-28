import { getAuth } from ".";

 

export async function getTokens(code:string){
    const auth=getAuth();
    const tokens=await auth.getToken(code);
    const {access_token:accessToken,refresh_token:refreshToken,expiry_date:expiryDate}=tokens.tokens;

    if(typeof accessToken!=='string'||typeof refreshToken!=='string'||typeof expiryDate!=='number')
        throw new Error("Tokens are wrong types");
    return {accessToken,refreshToken,expiryDate};
}