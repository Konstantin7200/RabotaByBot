import { sendMessage } from "./sendMessage"

export type NotificationToSend={
    vacancy:string,
    employer:string,
    outcome:'Accepted'|'Rejected'|'Unknown'
}
export async function sendNotifications(chatId:number,notifications:NotificationToSend[]){
    notifications.forEach((notification)=>{
        sendMessage(chatId,createNotificationText(notification));
    })
}

function createNotificationText(notification:NotificationToSend){
    return `The outcome of vacancy ${notification.vacancy} from employer ${notification.employer} is ${notification.outcome}`;
}