import type { gmail_v1 } from "@googleapis/gmail";
import { convert, HtmlToTextOptions } from "html-to-text";

const htmlConversionOptions: HtmlToTextOptions = {
    wordwrap: false,
    selectors: [
        { selector: "a", options: { ignoreHref: true } },
        { selector: "img", format: "skip" }
    ]
};

function decodeBodyData(data: string): string {
    return Buffer.from(data, "base64url").toString("utf8");
}

function collectPartData(part: gmail_v1.Schema$MessagePart | null | undefined, mimeType: string, acc: string[]): void {
    if (!part)
        return;
    if (part.mimeType === mimeType && part.body?.data)
        acc.push(decodeBodyData(part.body.data));
    for (const child of part.parts ?? [])
        collectPartData(child, mimeType, acc);
}

function normalize(text: string): string {
    return text.replace(/\r\n/g, "\n").replace(/\u00A0/g, " ");
}

export function messageBodyToText(payload: gmail_v1.Schema$MessagePart | null | undefined): string | null {
    const plainParts: string[] = [];
    const htmlParts: string[] = [];
    collectPartData(payload, "text/plain", plainParts);
    collectPartData(payload, "text/html", htmlParts);
    if (plainParts.length > 0)
        return normalize(plainParts.join("\n"));
    if (htmlParts.length > 0)
        return normalize(convert(htmlParts.join("\n"), htmlConversionOptions));
    return null;
}
