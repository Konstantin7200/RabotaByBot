import { describe, expect, it, vi } from "vitest";

vi.mock(".", () => ({ getBot: vi.fn() }));
vi.mock("./startHandler", () => ({ startHandler: vi.fn() }));
vi.mock("./unlinkHandler", () => ({ unlinkHandler: vi.fn() }));
vi.mock("./statusHandler", () => ({ statusHandler: vi.fn() }));

import { getBot } from ".";
import { BOT_COMMANDS, loadHandlers } from "./loadHandlers";
import { CMD } from "../constants";

const bot = { command: vi.fn(), api: { setMyCommands: vi.fn().mockResolvedValue(undefined) } };

describe("loadHandlers (command helper)", () => {
    it("registers every command from the central list with its handler", () => {
        vi.mocked(getBot).mockReturnValue(bot as never);
        loadHandlers();
        expect(bot.command).toHaveBeenCalledTimes(BOT_COMMANDS.length);
        for (const { command, handler } of BOT_COMMANDS)
            expect(bot.command).toHaveBeenCalledWith(command, handler);
    });

    it("exposes the known commands (start, status, unlink)", () => {
        expect(BOT_COMMANDS.map((c) => c.command)).toEqual([CMD.START, CMD.STATUS, CMD.UNLINK]);
    });

    it("publishes the same list to Telegram's command menu", async () => {
        vi.mocked(getBot).mockReturnValue(bot as never);
        loadHandlers();
        expect(bot.api.setMyCommands).toHaveBeenCalledWith(BOT_COMMANDS.map(({ command, description }) => ({ command, description })));
        await vi.waitFor(() => expect(bot.api.setMyCommands).toHaveBeenCalledTimes(1));
    });

    it("does not throw when Telegram rejects setMyCommands", async () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
        try {
            vi.mocked(getBot).mockReturnValue({ command: vi.fn(), api: { setMyCommands: vi.fn().mockRejectedValue(new Error("tg down")) } } as never);
            expect(() => loadHandlers()).not.toThrow();
            await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
        } finally {
            spy.mockRestore();
        }
    });
});

describe("BOT_COMMANDS descriptions", () => {
    it("are non-empty and within Telegram's 256-char limit", () => {
        for (const { description } of BOT_COMMANDS) {
            expect(description.length).toBeGreaterThan(0);
            expect(description.length).toBeLessThanOrEqual(256);
        }
    });
});
