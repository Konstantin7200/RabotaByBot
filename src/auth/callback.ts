import { Request,Response } from "express";
import { getFromMemcache } from "../memcache";
import { getTokens } from "./getTokens";
import { sendMessage } from "../bot/sendMessage";

export async function callback(req:Request,res:Response){
    const state=req.query['state'];
    if(typeof state!=='string')
        throw new Error("State isnt string");
    const id=getFromMemcache(state)
    if(id===undefined)
        throw new Error('State not found in storage');
    const code=req.params['code']
    if(typeof code!=='string')
        throw new Error('Code isnt a string');
    const tokens=await getTokens(code);
    sendMessage(id,"You are logged in");
    res.send("Ok");
    return [tokens]
}