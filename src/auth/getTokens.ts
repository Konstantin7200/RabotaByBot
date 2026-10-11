import { auth } from ".";

 

export async function getTokens(code:string){
    const tokens=await auth.getToken(code);
    const {access_token:accessToken,refresh_token:refreshToken,expiry_date:expiryDate,id_token:idToken}=tokens.tokens;

    if(typeof accessToken!=='string'||typeof refreshToken!=='string'||typeof expiryDate!=='number'||typeof idToken!=='string')
        throw new Error("Tokens are wrong types");
    return {accessToken,refreshToken,expiryDate,idToken};
}