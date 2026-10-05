import { gmail_v1 } from "@googleapis/gmail";

export async function getMessageIds(gmail:gmail_v1.Gmail,email:string,startId:string){
    const response=await gmail.users.history.list({userId:email,startHistoryId:startId,historyTypes: ['messageAdded']});
    const history=response.data.history??[];
    const messageIdSet=new Set<string>();
    for(const historyItem of history){
        for(const addedItem of historyItem.messagesAdded??[])
            if(addedItem.message?.id){
                messageIdSet.add(addedItem.message.id);
            }
    }
    if(!response.data.historyId)
        throw new Error('No new history id provided');
    return  {
        messageIds:Array.from(messageIdSet),
        newHistoryId:response.data.historyId
    };
}