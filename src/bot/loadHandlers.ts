import { startHandler } from "./startHandler";
import { unlinkHandler } from "./unlinkHandler";
import { statusHandler } from "./statusHandler";
import { getBot } from ".";
import { CMD } from "../constants";
import { log } from "../logger";

// Single source for handler registration and the Telegram command menu
// (setMyCommands): add/rename a command here only.
export const BOT_COMMANDS = [
    { command: CMD.START, description: "Link or re-link your Google mailbox", handler: startHandler },
    { command: CMD.STATUS, description: "Show mailbox status and login expiry", handler: statusHandler },
    { command: CMD.UNLINK, description: "Disconnect the mailbox and revoke access", handler: unlinkHandler },
] as const;

export function loadHandlers(){
    const bot=getBot();

    for (const { command, handler } of BOT_COMMANDS)
        bot.command(command, handler)

    void bot.api.setMyCommands(BOT_COMMANDS.map(({ command, description }) => ({ command, description })))
        .catch((err) => log.error({ event: "set_my_commands_failed", err: String(err) }));
}
