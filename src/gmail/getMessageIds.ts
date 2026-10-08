import { gmail_v1 } from "@googleapis/gmail";

export async function getMessageIds(gmail:gmail_v1.Gmail,email:string,startId:string){
    const messageIdSet=new Set<string>();
    let newHistoryId:string|undefined;
    let pageToken:string|undefined;
    const seenTokens=new Set<string>();
    do{
        const response=await gmail.users.history.list({userId:email,startHistoryId:startId,historyTypes: ['messageAdded'],pageToken});
        const history=response.data.history??[];
        for(const historyItem of history){
            for(const addedItem of historyItem.messagesAdded??[])
                if(addedItem.message?.id){
                    messageIdSet.add(addedItem.message.id);
                }
        }
        if(response.data.historyId)
            newHistoryId=response.data.historyId;
        const nextPage=response.data.nextPageToken;
        pageToken=typeof nextPage==='string'&&!seenTokens.has(nextPage)?nextPage:undefined;
        if(typeof nextPage==='string')
            seenTokens.add(nextPage);
    }while(pageToken!==undefined);
    if(!newHistoryId)
        throw new Error('No new history id provided');
    return  {
        messageIds:Array.from(messageIdSet),
        newHistoryId
    };
}
