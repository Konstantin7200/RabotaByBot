type NotificationMessageBody = {
    message: {
        data: string;
        messageId: string;
        publishTime: string;
        attributes?: Record<string, string>;
    };
    subscription: string;
};
type UnvalidatedNotificationMessageBody = {
    message: {
        data: unknown;
        messageId: unknown;
        publishTime: unknown;
        attributes?: unknown;
    };
    subscription: unknown;
};


export function isNotificationMessageBody(
    value: object
): value is NotificationMessageBody {
    if (!isValueObject(value))
        return false;
    if (!Object.hasOwn(value, "message")) return false;
    const message = value.message;
    if (typeof message !== "object" || message === null) return false;
    if (!Object.hasOwn(message, "data") || typeof message.data !== "string") return false;

    if (!Object.hasOwn(value, "subscription") || typeof value.subscription !== "string") return false;

    return true;
}
function isValueObject(value: object): value is UnvalidatedNotificationMessageBody {
    if (typeof value !== "object" || value === null) return false;
    return true;
}
