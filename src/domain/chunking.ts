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
/** The same enders, for the Latin path, which splits on them one by one. */
const LATIN_END = new Set([".", "!", "?"]);

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
 * Tidy pasted Vocabulary text: trim each line, drop blank lines, and collapse
 * runs of spaces or tabs inside a line. Line breaks are kept — they are what
 * separates one Vocabulary Item from the next.
 */
export function formatVocabText(text: string): string {
  return text
    .split(/\r\n|\r|\n/)
    .map((line) => line.replace(/[ \t\u3000]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * Turn a Passage into the Chunks that get spoken one at a time.
 *
 * Vocabulary mode is one item per line — a Vocabulary Item is simply a very
 * short Passage, so a line that turns out to be longer than a Chunk is one
 * again. Paragraph mode splits on sentence boundaries, with a
 * clause-level fallback for over-long sentences.
 */
export function toChunks(text: string, mode: Mode, _language: LanguageId): string[] {
  if (mode === "vocab") {
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap(wrapItem);
  }

  const trimmed = text.trim();
  if (!trimmed) return [];

  if (CJK.test(trimmed)) {
    return byLength(splitAfter(trimmed, SENTENCE_END)).filter(Boolean);
  }

  // Latin script: split on sentence enders.
  const sentences = trimmed
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  // The lookbehind split can't see "end.Next" with no space, so guard it.
  const repaired = sentences.flatMap((s) =>
    splitAfter(s, LATIN_END).length > 1 ? splitAfter(s, LATIN_END) : [s],
  );

  return byLength(repaired).filter(Boolean);
}

/**
 * Break a Vocabulary Item that is over the cap back into Chunks, cutting on a
 * space where there is one so that a word is never split down the middle.
 *
 * CHUNK_CHAR_CAP bounds a Chunk for a reason: Grading builds a table quadratic
 * in its length, and Results draws one node per character. An item longer than
 * the cap is usually a whole sentence pasted into the wrong column, so splitting
 * it is more useful than refusing to start.
 */
function wrapItem(line: string): string[] {
  if ([...line].length <= CHUNK_CHAR_CAP) return [line];

  const out: string[] = [];
  let rest = [...line];
  while (rest.length > CHUNK_CHAR_CAP) {
    // Index CHUNK_CHAR_CAP itself is the hard cut; look one past it for a space.
    let cut = CHUNK_CHAR_CAP;
    for (let i = CHUNK_CHAR_CAP; i > 0; i--) {
      if (/\s/.test(rest[i] ?? "")) {
        cut = i;
        break;
      }
    }
    out.push(rest.slice(0, cut).join("").trim());
    rest = rest.slice(cut);
  }
  if (rest.join("").trim()) out.push(rest.join("").trim());
  return out.filter(Boolean);
}

/** Characters that count toward Grading, ignoring what people don't control. */
export function significantLength(text: string): number {
  return stripInsignificant(text).length;
}

export function stripInsignificant(text: string): string {
  return text.replace(/[\s，。！？、,.!?;:'"()（）—–-]/g, "");
}
