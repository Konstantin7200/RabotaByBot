export function renderNotification(notification: { vacancy: string | null; employer: string | null; outcome: string | null; subject: string | null }): string {
    const vacancy = notification.vacancy ?? "Unknown";
    const employer = notification.employer ?? "Unknown";
    const outcome = notification.outcome ?? notification.subject ?? "Unknown";
    return `The outcome of vacancy ${vacancy} from employer ${employer} is ${outcome}`;
}
