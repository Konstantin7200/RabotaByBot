import { Cron } from "croner";
import { CATCHUP_TICK, DELIVERY_TICK, HEARTBEAT_TICK, TOKEN_EXPIRY_WARN_TICK, WATCH_RENEWAL_TICK } from "../constants";
import { renewWatches } from "./jobs/renewWatches";
import { runDeliveryPass } from "./jobs/deliverNotifications";
import { runCatchUpPass } from "./jobs/catchUpPass";
import { heartbeat } from "./jobs/heartbeat";
import { warnTokenExpiry } from "./jobs/warnTokenExpiry";

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
    const catchUpJob = new Cron(CATCHUP_TICK, {
        protect: () => {
            console.log({ event: "job_skipped_overlap", job: "catch_up_pass" });
        },
        catch: (err) => {
            console.log({ event: "job_error", job: "catch_up_pass", err: String(err) });
        },
    }, runCatchUpPass);
    jobs.push(catchUpJob);
    catchUpJob.trigger();
    const heartbeatJob = new Cron(HEARTBEAT_TICK, {
        protect: () => {
            console.log({ event: "job_skipped_overlap", job: "heartbeat" });
        },
        catch: (err) => {
            console.log({ event: "job_error", job: "heartbeat", err: String(err) });
        },
    }, heartbeat);
    jobs.push(heartbeatJob);
    heartbeatJob.trigger();
    const tokenExpiryJob = new Cron(TOKEN_EXPIRY_WARN_TICK, {
        protect: () => {
            console.log({ event: "job_skipped_overlap", job: "warn_token_expiry" });
        },
        catch: (err) => {
            console.log({ event: "job_error", job: "warn_token_expiry", err: String(err) });
        },
    }, warnTokenExpiry);
    jobs.push(tokenExpiryJob);
    tokenExpiryJob.trigger();
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
    console.log({
        event: "scheduler_started",
        job: "catch_up_pass",
        tick: CATCHUP_TICK,
        nextRun: catchUpJob.nextRun(),
    });
    console.log({
        event: "scheduler_started",
        job: "heartbeat",
        tick: HEARTBEAT_TICK,
        nextRun: heartbeatJob.nextRun(),
    });
    console.log({
        event: "scheduler_started",
        job: "warn_token_expiry",
        tick: TOKEN_EXPIRY_WARN_TICK,
        nextRun: tokenExpiryJob.nextRun(),
    });
}

export function stopScheduler() {
    for (const job of jobs)
        job.stop();
    jobs.length = 0;
    console.log({ event: "scheduler_stopped" });
}
