import { Cron } from "croner";
import { DELIVERY_TICK, WATCH_RENEWAL_TICK } from "../constants";
import { renewWatches } from "./jobs/renewWatches";
import { runDeliveryPass } from "./jobs/deliverNotifications";

const jobs: Cron[] = [];

export function startScheduler() {
    const renewJob = new Cron(WATCH_RENEWAL_TICK, {
        protect: () => {
            console.log({ event: "job_skipped_overlap", job: "renew_watches" });
        },
        catch: (err) => {
            console.log({ event: "job_error", job: "renew_watches", err: String(err) });
        },
    }, renewWatches);
    jobs.push(renewJob);
    renewJob.trigger();
    const deliveryJob = new Cron(DELIVERY_TICK, {
        protect: () => {
            console.log({ event: "job_skipped_overlap", job: "deliver_notifications" });
        },
        catch: (err) => {
            console.log({ event: "job_error", job: "deliver_notifications", err: String(err) });
        },
    }, runDeliveryPass);
    jobs.push(deliveryJob);
    deliveryJob.trigger();
    console.log({
        event: "scheduler_started",
        job: "renew_watches",
        tick: WATCH_RENEWAL_TICK,
        nextRun: renewJob.nextRun(),
    });
    console.log({
        event: "scheduler_started",
        job: "deliver_notifications",
        tick: DELIVERY_TICK,
        nextRun: deliveryJob.nextRun(),
    });
}

export function stopScheduler() {
    for (const job of jobs)
        job.stop();
    jobs.length = 0;
    console.log({ event: "scheduler_stopped" });
}
