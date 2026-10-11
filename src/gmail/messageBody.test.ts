import { describe, expect, it } from "vitest";
import type { gmail_v1 } from "@googleapis/gmail";
import { messageBodyToText } from "./messageBody";

function encode(data: string): string {
    return Buffer.from(data, "utf8").toString("base64url");
}

const htmlBody = [
    "<html><body><div>",
    "<b>Вакансия:</b> Junior Software Engineer<br>",
    "<b>компании:</b> Specific-Group<br>",
    "<a href=\"https://rabota.by/vac/123\">Посмотреть вакансию</a><br>",
    "R&amp;D&nbsp;department",
    "</div></body></html>"
].join("");

describe("messageBodyToText", () => {
    it("converts a single-part text/html payload to plain text", () => {
        const payload: gmail_v1.Schema$MessagePart = {
            mimeType: "text/html",
            body: { data: encode(htmlBody) }
        };
        const text = messageBodyToText(payload);
        expect(text).toContain("Вакансия: Junior Software Engineer");
        expect(text).toContain("компании: Specific-Group");
        expect(text).toContain("Посмотреть вакансию");
        expect(text).toContain("R&D department");
    });

    it("drops image tags and link hrefs, keeping link text", () => {
        const payload: gmail_v1.Schema$MessagePart = {
            mimeType: "text/html",
            body: { data: encode(htmlBody) }
        };
        const text = messageBodyToText(payload) ?? "";
        expect(text).not.toContain("https://rabota.by/vac/123");
        expect(text).not.toContain("<img");
    });

    it("disables word wrapping so lines are not broken at 80 chars", () => {
        const longLine = "Вакансия: " + "очень длинная строка ".repeat(10);
        const payload: gmail_v1.Schema$MessagePart = {
            mimeType: "text/html",
            body: { data: encode(`<p>${longLine}</p>`) }
        };
        const text = messageBodyToText(payload) ?? "";
        expect(text).toBe(longLine.trimEnd());
    });

    it("prefers text/plain over text/html when both alternatives exist", () => {
        const payload: gmail_v1.Schema$MessagePart = {
            mimeType: "multipart/mixed",
            parts: [
                {
                    mimeType: "multipart/alternative",
                    parts: [
                        { mimeType: "text/plain", body: { data: encode("Вакансия: Plain") } },
                        { mimeType: "text/html", body: { data: encode("<p>Вакансия: Html</p>") } }
                    ]
                }
            ]
        };
        expect(messageBodyToText(payload)).toBe("Вакансия: Plain");
    });

    it("falls back to html when no plain part exists", () => {
        const payload: gmail_v1.Schema$MessagePart = {
            mimeType: "multipart/alternative",
            parts: [
                { mimeType: "text/html", body: { data: encode("<p>Только html</p>") } }
            ]
        };
        expect(messageBodyToText(payload)).toContain("Только html");
    });

    it("returns null for container-only or empty payloads", () => {
        expect(messageBodyToText({ mimeType: "multipart/alternative", parts: [] })).toBeNull();
        expect(messageBodyToText(null)).toBeNull();
        expect(messageBodyToText(undefined)).toBeNull();
    });
});
