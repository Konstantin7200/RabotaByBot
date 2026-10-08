import { Cron } from "croner";
import { WATCH_RENEWAL_TICK } from "../constants";
import { renewWatches } from "./jobs/renewWatches";

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
    console.log({
        event: "scheduler_started",
        job: "renew_watches",
        tick: WATCH_RENEWAL_TICK,
        nextRun: renewJob.nextRun(),
    });
}

export function stopScheduler() {
    for (const job of jobs)
        job.stop();
    jobs.length = 0;
    console.log({ event: "scheduler_stopped" });
}
