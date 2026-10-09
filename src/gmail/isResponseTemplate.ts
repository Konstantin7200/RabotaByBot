// UNCONFIRMED: Rabota.by response-letter subject templates are not verified
// against a real sample yet (assignment §6.3). With no patterns configured the
// gate passes every letter from the rabota.by domain; patterns are a defense
// in depth against newsletters/digests once real subjects are known.
export function isResponseTemplate(subject: string, patterns: readonly string[]): boolean {
    if (patterns.length === 0)
        return true;
    const lower = subject.toLowerCase();
    return patterns.some(pattern => lower.includes(pattern.toLowerCase()));
}
