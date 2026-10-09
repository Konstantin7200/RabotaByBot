import { Cron, CronOptions } from "croner";
import {
    CATCHUP_TICK,
    DELIVERY_TICK,
    HEARTBEAT_TICK,
    RETENTION_TICK,
    TOKEN_EXPIRY_WARN_TICK,
    WATCH_RENEWAL_TICK,
} from "../constants";
import { renewWatches } from "./jobs/renewWatches";
import { runDeliveryPass } from "./jobs/deliverNotifications";
import { runCatchUpPass } from "./jobs/catchUpPass";
import { heartbeat } from "./jobs/heartbeat";
import { warnTokenExpiry } from "./jobs/warnTokenExpiry";
import { runRetentionCleanup } from "./jobs/runRetentionCleanup";

const jobs: Cron[] = [];

// WP14: count in-flight job runs so shutdown can drain them before exit.
let activeJobs = 0;
let idleWaiter: (() => void) | null = null;

function track(fn: () => unknown) {
    return async () => {
        activeJobs += 1;
        try {
            await fn();
        } finally {
            activeJobs -= 1;
            if (activeJobs === 0 && idleWaiter !== null) {
                const resolve = idleWaiter;
                idleWaiter = null;
                resolve();
            }
        }
    };
}

export function waitForIdleJobs(timeoutMs: number): Promise<void> {
    if (activeJobs === 0)
        return Promise.resolve();
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            idleWaiter = null;
            console.log({ event: "job_drain_timeout", activeJobs });
            resolve();
        }, timeoutMs);
        timer.unref();
        idleWaiter = () => {
            clearTimeout(timer);
            resolve();
        };
    });
}

function schedule(name: string, tick: string, fn: () => unknown) {
    const options: CronOptions = {
        protect: () => {
            console.log({ event: "job_skipped_overlap", job: name });
        },
        catch: (err) => {
            console.log({ event: "job_error", job: name, err: String(err) });
        },
    };
    const job = new Cron(tick, options, track(fn));
    jobs.push(job);
    job.trigger();
    console.log({ event: "scheduler_started", job: name, tick, nextRun: job.nextRun() });
    return job;
}

export function startScheduler() {
    schedule("renew_watches", WATCH_RENEWAL_TICK, renewWatches);
    schedule("deliver_notifications", DELIVERY_TICK, runDeliveryPass);
    schedule("catch_up_pass", CATCHUP_TICK, runCatchUpPass);
    schedule("heartbeat", HEARTBEAT_TICK, heartbeat);
    schedule("warn_token_expiry", TOKEN_EXPIRY_WARN_TICK, warnTokenExpiry);
    schedule("retention_cleanup", RETENTION_TICK, runRetentionCleanup);
}

export function stopScheduler() {
    for (const job of jobs)
        job.stop();
    jobs.length = 0;
    console.log({ event: "scheduler_stopped", activeJobs });
}
