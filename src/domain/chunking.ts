import type { LanguageId, Mode } from "./types";

/**
 * Longest a single Chunk may be. Chinese and English are chunked on sentence
 * boundaries first; anything still over this is split again at clause
 * punctuation. See GLOSSARY.md.
 */
export const CHUNK_CHAR_CAP = 70;

const CJK = /[㐀-鿿豈-﫿]/;

/** Chinese sentence enders, English ones, and their full-width forms. */
const SENTENCE_END = new Set(["。", "！", "？", "!", "?", "．", "."]);
const CLAUSE_END = new Set(["，", "、", "；", ",", ";", "：", ":"]);

/** Split after the given punctuation, keeping it attached to the left part. */
function splitAfter(text: string, enders: Set<string>): string[] {
  const out: string[] = [];
  let buf = "";
  for (const ch of text) {
    buf += ch;
    if (enders.has(ch)) {
      out.push(buf.trim());
      buf = "";
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

function byLength(parts: string[]): string[] {
  return parts.flatMap((part) =>
    [...part].length > CHUNK_CHAR_CAP ? splitAfter(part, CLAUSE_END) : [part],
  );
}

/**
 * Turn a Passage into the Chunks that get spoken one at a time.
 *
 * Vocabulary mode is one item per line — a Vocabulary Item is simply a very
 * short Passage. Paragraph mode splits on sentence boundaries, with a
 * clause-level fallback for over-long sentences.
 */
export function toChunks(text: string, mode: Mode, _language: LanguageId): string[] {
  if (mode === "vocab") {
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }

  const trimmed = text.trim();
  if (!trimmed) return [];

  if (CJK.test(trimmed)) {
    return byLength(splitAfter(trimmed, SENTENCE_END)).filter(Boolean);
  }

  // Latin script: split on sentence enders, but not on the dot in "Mr." / "3.5".
  const sentences = trimmed
    .split(/(?<=[.!?])\s+/)
    .flatMap((s) => (isAbbreviation(s) ? [s] : s))
    .map((s) => s.trim())
    .filter(Boolean);

  // The lookbehind split can't see "end.Next" with no space, so guard it.
  const repaired = sentences.flatMap((s) =>
    splitAfter(s, new Set([".", "!", "?"])).length > 1
      ? splitAfter(s, new Set([".", "!", "?"]))
      : [s],
  );

  return byLength(repaired).filter(Boolean);
}

const ABBREVIATION = /\b(mr|mrs|ms|dr|prof|jr|sr|st|vs|etc|e\.g|i\.e|no)\.$/i;

function isAbbreviation(sentence: string): boolean {
  return ABBREVIATION.test(sentence);
}

/** Characters that count toward Grading, ignoring what people don't control. */
export function significantLength(text: string): number {
  return stripInsignificant(text).length;
}

export function stripInsignificant(text: string): string {
  return text.replace(/[\s，。！？、,.!?;:'"()（）—–-]/g, "");
}
