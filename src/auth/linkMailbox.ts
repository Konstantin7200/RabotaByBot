import { auth } from ".";
import { EnvConfig } from "../config";
import { getTokens } from "./getTokens";
import { createIfNotExists, getByChatId, getChatIdByUserId } from "../db/userRepository";
import { InsertedMailbox, InsertedUser, MailboxesTable } from "../db/entityTypes";
import { getByUserId, getMailbox, linkMailboxAtomically } from "../db/mailboxRepository";
import { installWatch } from "../gmail/watch";
import { remoteUntrack } from "../gmail/untrackMailbox";
import { sendMessage } from "../bot/sendMessage";
import { notifyChat } from "./notifyChat";
import {
    chooseLoginMessage,
    createReplacedMailboxMessage,
    MESSAGE_MAILBOX_RELINKED
} from "../constants";

export type LinkedAccount = {
    email: string;
    // True when an already-tracked mailbox had a watch basis before this link;
    // the caller may kick off a catch-up replay for the new owner.
    relinkedExisting: boolean;
};

async function cleanupReplacedMailbox(oldMailbox:MailboxesTable,newEmail:string,chatId:number){
    const result=await remoteUntrack(oldMailbox);
    if(!result.stopped||!result.revoked)
        console.log({event:"replaced_unlink_incomplete",email:oldMailbox.email,stopped:result.stopped,revoked:result.revoked});
    try{
        await sendMessage(chatId,createReplacedMailboxMessage(oldMailbox.email,newEmail));
    } catch(err){
        console.log({event:"notify_replaced_mailbox_failed",err:String(err)});
    }
}

async function notifyPreviousOwner(oldChatId:number,email:string){
    try{
        await sendMessage(oldChatId,MESSAGE_MAILBOX_RELINKED(email));
    } catch(err){
        console.log({event:"notify_previous_owner_failed",err:String(err)});
    }
}

// OAuth half of the mailbox link: everything after the callback handler has
// consumed the one-time state and extracted the authorization code. Throws on
// any failure - the HTTP layer decides how to report it.
export async function linkMailbox(chatId:string,code:string):Promise<LinkedAccount>{
    const numericChatId=parseInt(chatId,10);
    const userToCreate:InsertedUser={
        chatId,
        chatStatus:'ok',
    }
    await createIfNotExists(userToCreate);
    const tokens=await getTokens(code);
    const user=await getByChatId(chatId);
    if(user===null)
        throw new Error('User not found');
    const ticket=await auth.verifyIdToken({
        idToken:tokens.idToken,
        audience:EnvConfig.googleAuth.clientId
    });
    const payload=ticket.getPayload();
    const email=payload?.email;
    if(typeof email!=='string')
        throw new Error('No email in id_token');
    const existing=await getMailbox(email);
    const previousStatus=existing!==null?existing.accessStatus:null;
    const previousChatId=existing!==null&&existing.userId!==null
        ? await getChatIdByUserId(existing.userId)
        : null;
    const oldMailbox=await getByUserId(user.id);
    // Install the watch before persisting anything: a failed watch must
    // leave the previous linkage untouched (US-1 CA3).
    const {historyId,expirationDate}=await installWatch(email,tokens.refreshToken,tokens.accessToken);
    const replacedUserId=oldMailbox!==null&&oldMailbox.email!==email?oldMailbox.userId:null;
    const mailboxToCreate:InsertedMailbox={
        userId:user.id,
        email,
        refreshToken:tokens.refreshToken
    };
    // Old-mailbox unlink, new-mailbox insert and the watch basis commit in
    // ONE transaction (FR-3/FR-15): a mid-flow failure can no longer leave
    // the old linkage destroyed with no new one, nor an active mailbox
    // without a watch. Remote cleanup and notices run after the commit.
    await linkMailboxAtomically(mailboxToCreate,{historyIdBasis:historyId,watchExpiration:expirationDate},replacedUserId);
    if(oldMailbox!==null&&oldMailbox.email!==email)
        await cleanupReplacedMailbox(oldMailbox,email,numericChatId);
    if(previousChatId!==null&&Number(previousChatId)!==numericChatId)
        await notifyPreviousOwner(Number(previousChatId),email);
    console.log({event:"oauth_linked",email});
    notifyChat(numericChatId,chooseLoginMessage(email,previousStatus));
    return {email,relinkedExisting:existing!==null&&existing.historyIdBasis!==null};
}
