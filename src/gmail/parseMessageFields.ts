export interface ParsedMessageFields {
    vacancy: string | null;
    employer: string | null;
    outcome: string | null;
}

const OUTCOME_TEMPLATES: ReadonlyArray<{ pattern: RegExp; label: string }> = [
    { pattern: /не\s+готов\s+пригласить/i, label: "Отказ" },
    { pattern: /готов\s+пригласить/i, label: "Приглашение" }
];

function matchField(text: string, pattern: RegExp): string | null {
    const match = text.match(pattern);
    if (!match?.[1])
        return null;
    const value = match[1].trim();
    return value === "" ? null : value;
}

function parseOutcome(subject: string): string | null {
    for (const template of OUTCOME_TEMPLATES)
        if (template.pattern.test(subject))
            return template.label;
    return null;
}

export function parseMessageFields(text: string | null, subject: string): ParsedMessageFields {
    return {
        vacancy: text === null ? null : matchField(text, /^\s*Вакансия:\s*(.+)$/im),
        employer: text === null ? null : matchField(text, /^\s*компани(?:и|я):\s*(.+)$/im),
        outcome: parseOutcome(subject)
    };
}
