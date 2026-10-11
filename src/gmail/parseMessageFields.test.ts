import { describe, expect, it } from "vitest";
import { parseMessageFields } from "./parseMessageFields";

const rejectionSubject = "Работодатель не готов пригласить вас на собеседование";
const sampleText = [
    "Вакансия: Junior Software Engineer",
    "компании: Specific-Group",
    "Посмотреть вакансию можно по этой ссылке →",
    "Выбрать другую вакансию"
].join("\n");

describe("parseMessageFields", () => {
    it("extracts vacancy, employer and outcome from a real rejection sample", () => {
        const fields = parseMessageFields(sampleText, rejectionSubject);
        expect(fields.vacancy).toBe("Junior Software Engineer");
        expect(fields.employer).toBe("Specific-Group");
        expect(fields.outcome).toBe("Отказ");
    });

    it("is case-insensitive on labels and tolerates extra whitespace", () => {
        const text = "  ВАКАНСИЯ:   Frontend Dev  \n  Компании:  ACME  ";
        const fields = parseMessageFields(text, rejectionSubject);
        expect(fields.vacancy).toBe("Frontend Dev");
        expect(fields.employer).toBe("ACME");
    });

    it("detects invitation outcome by template order (rejection checked first)", () => {
        expect(parseMessageFields(null, "Работодатель готов пригласить вас на собеседование").outcome)
            .toBe("Приглашение");
        expect(parseMessageFields(null, rejectionSubject).outcome).toBe("Отказ");
    });

    it("returns nulls for missing body and unknown subject", () => {
        const fields = parseMessageFields(null, "Любая другая тема");
        expect(fields).toEqual({ vacancy: null, employer: null, outcome: null });
    });

    it("returns null fields when body has no labels", () => {
        const fields = parseMessageFields("какой-то текст без меток", rejectionSubject);
        expect(fields.vacancy).toBeNull();
        expect(fields.employer).toBeNull();
        expect(fields.outcome).toBe("Отказ");
    });
});
