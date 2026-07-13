/**
 * src/lib/ai/parseCitations.ts
 *
 * Phase 7 Part 3 — client-safe parser that splits AI Advisor message text on
 * the inline citation markers Part 2 composes ([[chunk:ID]] / [[control:ID]])
 * so the UI can render them as clickable chips instead of raw text.
 *
 * Robustness: only well-formed markers are recognized. Malformed or partial
 * markers (empty id, unknown type, unbalanced brackets) are left as plain text
 * — the parser never throws and never drops characters.
 */

export type CitationType = "chunk" | "control" | "evidence";

export type MessageSegment =
  | { kind: "text"; text: string }
  | { kind: "citation"; type: CitationType; id: string; raw: string };

// Well-formed marker: [[type:id]] where type is a known kind and id is one or
// more non-`]` chars. Non-greedy id so "]]" terminates cleanly.
const CITATION_RE = /\[\[(chunk|control|evidence):([^\]\s][^\]]*?)\]\]/g;

/**
 * Split message text into ordered text / citation segments. Concatenating
 * every segment's raw text reproduces the input exactly.
 */
export function parseMessageSegments(text: string): MessageSegment[] {
  if (!text) return [];
  const segments: MessageSegment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(CITATION_RE)) {
    const start = match.index ?? 0;
    if (start > lastIndex) {
      segments.push({ kind: "text", text: text.slice(lastIndex, start) });
    }
    segments.push({ kind: "citation", type: match[1] as CitationType, id: match[2].trim(), raw: match[0] });
    lastIndex = start + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ kind: "text", text: text.slice(lastIndex) });
  }
  return segments;
}

/** All distinct citations in a message, in first-seen order. */
export function extractCitations(text: string): Array<{ type: CitationType; id: string }> {
  const out: Array<{ type: CitationType; id: string }> = [];
  const seen = new Set<string>();
  for (const seg of parseMessageSegments(text)) {
    if (seg.kind === "citation") {
      const key = `${seg.type}:${seg.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ type: seg.type, id: seg.id });
      }
    }
  }
  return out;
}
