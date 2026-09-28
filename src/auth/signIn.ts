import { randomBytes } from "node:crypto";
import { getAuth } from ".";
import { setToMemcache } from "../memcache";

export function getAuthUrl(id:number){
    const scopes=['https://www.googleapis.com/auth/gmail.readonly']
    const auth=getAuth();
    const state=randomBytes(16).toString('hex');
    setToMemcache(state,id);
    const generatedAuthUrl=auth.generateAuthUrl({
        scope:scopes,
        prompt:'consent',
        access_type:'offline',
        state:state
    })
    return generatedAuthUrl;
}