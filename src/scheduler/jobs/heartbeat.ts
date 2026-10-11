import { touchHeartbeat } from "../../db/appStateRepository";

export async function heartbeat() {
    await touchHeartbeat(new Date());
}
