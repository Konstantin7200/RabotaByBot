
type NotificationBody={
  emailAddress: string,
  historyId: string
}
export type UnvalidatedNotificationBody={
  emailAddress: unknown,
  historyId: unknown
}
export function validateNotificationPayload(value:UnvalidatedNotificationBody):value is NotificationBody{
    if(!Object.hasOwn(value,'emailAddress')||!(typeof value.emailAddress==='string'))
        return false;
    if(!Object.hasOwn(value,'historyId')||!(typeof value.historyId==='string'))
        return false;
    return true;
}