export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

// Threshold defaults to "info"; the bootstrap (src/index.ts) re-configures it
// from the validated config. Importing this module never loads the config, so
// unit tests stay hermetic.
let threshold: LogLevel = "info";

export function configureLogger(level: LogLevel): void {
    threshold = level;
}

type LogFields = Record<string, unknown>;

function emit(level: LogLevel, fields: LogFields): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[threshold])
        return;
    const line = { level, time: new Date().toISOString(), ...fields };
    // The only place in the codebase allowed to touch console.* (see eslint).
    if (level === "error")
        console.error(line);
    else if (level === "warn")
        console.warn(line);
    else
        console.log(line);
}

export const log = {
    debug: (fields: LogFields) => emit("debug", fields),
    info: (fields: LogFields) => emit("info", fields),
    warn: (fields: LogFields) => emit("warn", fields),
    error: (fields: LogFields) => emit("error", fields),
};
