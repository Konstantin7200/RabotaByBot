import { gmail_v1 } from "@googleapis/gmail";

export async function listMessageIdsSince(gmail:gmail_v1.Gmail,email:string,afterUnixSeconds:number){
    const idSet=new Set<string>();
    let pageToken:string|undefined;
    const seenTokens=new Set<string>();
    do{
        const response=await gmail.users.messages.list({
            userId:email,
            q:`from:rabota.by after:${afterUnixSeconds}`,
            includeSpamTrash:true,
            maxResults:100,
            pageToken,
        });
        for(const message of response.data.messages??[])
            if(message.id){
                idSet.add(message.id);
            }
        const nextPage=response.data.nextPageToken;
        if(typeof nextPage==='string'){
            if(seenTokens.has(nextPage))
                throw new Error('Repeated messages page token');
            seenTokens.add(nextPage);
            pageToken=nextPage;
        }else{
            pageToken=undefined;
        }
    }while(pageToken!==undefined);
    return Array.from(idSet);
}
