import type { LanguageId, Mode } from "./types";
import { toSentences } from "./sentences";

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
 * What Chinese text keeps: Han characters, the punctuation Chinese is written
 * with (including the ASCII sentence marks some people type), and whitespace.
 * Everything else — Latin letters, pinyin tone marks, digits, and stray
 * symbols — is dropped.
 */
const KEEP_IN_CHINESE =
  /[^\p{Script=Han}\s.,!?;:\u00B7\u2010-\u2015\u2018\u2019\u201C\u201D\u2026\u3000-\u303F\uFE10-\uFE1F\uFE30-\uFE4F\uFF01-\uFF0F\uFF1A-\uFF20\uFF3B-\uFF40\uFF5B-\uFF65]/gu;

/** A line with no Han character left is a gloss or a romanisation, not content. */
const HAN = /\p{Script=Han}/u;

/** Brackets left empty once the pinyin or gloss they held has been dropped. */
const EMPTY_BRACKETS = /[（【〔〈《「『]\s*[）】〕〉》」』]/g;

/** Chinese is written without spaces around its punctuation. */
const SPACE_AROUND_CHINESE_PUNCTUATION = [
  /\s+([，。！？、；：）】〕〉》」』”’…—·])/g,
  /([（【〔〈《「『“‘])\s+/g,
  /([，。！？、；：）】〕〉》」』”’…—·])\s+/g,
];

function tidyLine(line: string, language: LanguageId): string {
  if (language === "en") return line.replace(/[ \t\u3000]+/g, " ").trim();

  let kept = line.replace(KEEP_IN_CHINESE, "").replace(EMPTY_BRACKETS, "");
  // Keep an ASCII mark only where a Han character is right next to it; one
  // stranded by removed English or pinyin is a leftover, not punctuation.
  kept = kept.replace(/[.,!?;:]+/g, (marks: string, offset: number, whole: string) => {
    const before = whole[offset - 1] ?? "";
    const after = whole[offset + marks.length] ?? "";
    return HAN.test(before) || HAN.test(after) ? marks : "";
  });
  for (const pattern of SPACE_AROUND_CHINESE_PUNCTUATION) kept = kept.replace(pattern, "$1");
  return kept.replace(/[ \t\u3000]+/g, " ").trim();
}

/**
 * Tidy pasted text for the format button: trim each line, drop blank lines,
 * collapse runs of spaces or tabs, and — for Chinese — remove pinyin, English,
 * and anything else that is not a Han character or punctuation.
 *
 * In Paragraph mode the result is split into Chunks, one per line, so that
 * every line is one Chunk. A line break the person typed is a Chunk boundary
 * of their own making, and is kept as one.
 */
export function formatText(text: string, language: LanguageId, mode: Mode): string {
  const tidied = text
    .split(/\r\n|\r|\n/)
    .map((line) => tidyLine(line, language))
    .filter((line) => line && (language === "en" || HAN.test(line)))
    .join("\n");

  return mode === "paragraph" ? toChunks(tidied, "paragraph").join("\n") : tidied;
}

/**
 * Turn a Passage into the Chunks that get spoken one at a time.
 *
 * Vocabulary mode is one item per line — a Vocabulary Item is simply a very
 * short Passage, so a line that turns out to be longer than a Chunk is one
 * again. Paragraph mode splits on sentence boundaries, with a
 * clause-level fallback for over-long sentences.
 *
 * Which of those applies is decided by what the text looks like, not by the
 * Language it was filed under: a Cantonese Passage written in Latin letters is
 * split on Latin sentence enders, because there are no CJK ones to find.
 *
 * A line break is always a Chunk boundary, in both modes. That lets someone
 * split a Passage by hand where sentence punctuation would not.
 */
export function toChunks(text: string, mode: Mode): string[] {
  if (mode === "vocab") {
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap(wrapItem);
  }

  return text
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) =>
      CJK.test(line)
        ? byLength(splitAfter(line, SENTENCE_END))
        : byLength(toSentences(line)),
    )
    .filter(Boolean);
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
