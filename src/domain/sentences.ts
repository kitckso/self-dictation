/**
 * Splitting Latin script into sentences.
 *
 * A full stop only ends a sentence when it is not part of an abbreviation, a
 * decimal or an initial. "Mr. Smith went home." is one sentence, and splitting
 * on /\.\s/ alone makes it two — which in an app that speaks one Chunk at a
 * time means dictating "Mr." on its own, with a pause before the name.
 */

/**
 * Titles and honorifics. A name follows these, so they never end a sentence.
 */
const TITLE_ABBREVIATION = new Set([
  "mr",
  "mrs",
  "ms",
  "dr",
  "prof",
  "rev",
  "hon",
  "st",
  "sr",
  "jr",
  "gen",
  "col",
  "capt",
  "sgt",
  "lt",
  "maj",
  "cmdr",
  "fr",
  "mt",
  "ft",
]);

/**
 * Words that may be abbreviated, and may still end a sentence.
 *
 * These are the ones that are not always followed by a name — "etc." can be
 * the last thing in a sentence — so each is decided by what comes after it.
 */
const SOFT_ABBREVIATION = new Set([
  "etc",
  "cf",
  "al",
  "vs",
  "no",
  "vol",
  "pp",
  "fig",
  "ch",
  "sec",
  "dept",
  "approx",
  "est",
  "min",
  "max",
  "avg",
  "inc",
  "ltd",
  "co",
  "ave",
  "blvd",
  "rd",
  "ed",
  "trans",
  "univ",
  "assn",
  "jan",
  "feb",
  "mar",
  "apr",
  "jun",
  "jul",
  "aug",
  "sep",
  "sept",
  "oct",
  "nov",
  "dec",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
]);

/**
 * Marks that close a sentence and belong to the sentence they close.
 *
 * The full stop is not in here: it is handled as a run of its own so that
 * "Wait..." stays in one piece.
 */
const CLOSING = new Set(['"', "'", "”", "’", ")", "]", "»", "!", "?"]);

/**
 * The dotted word a full stop belongs to, or null.
 *
 * "a.m." is one abbreviation spread over two dots, so the run has to be taken
 * as a whole: the first dot of it is decided by the second. A single letter
 * on its own is an initial, and has to be capital — "I said a." ends a
 * sentence, "J. Smith" does not.
 */
function dottedRun(text: string, dot: number): string | null {
  let firstLetter = dot - 1;
  let lastDot = dot;

  // Back over any pair already passed: a letter, then a dot, then a letter.
  while (
    firstLetter - 2 >= 0 &&
    text[firstLetter - 1] === "." &&
    /[A-Za-z]/.test(text[firstLetter - 2] ?? "")
  ) {
    firstLetter -= 2;
  }
  // And forward over any that follow.
  while (
    lastDot + 2 < text.length &&
    /[A-Za-z]/.test(text[lastDot + 1] ?? "") &&
    text[lastDot + 2] === "."
  ) {
    lastDot += 2;
  }

  if (firstLetter < 0 || !/[A-Za-z]/.test(text[firstLetter] ?? "")) return null;

  const word = text.slice(firstLetter, lastDot + 1);
  // One pair is an initial and has to be capital; two or more is a dotted
  // abbreviation, and may be either case.
  if (!/^(?:[A-Za-z]\.){1,3}$/.test(word)) return null;
  if (word.length === 2 && !/[A-Z]/.test(word[0] ?? "")) return null;

  // It has to be a whole word, not the tail of a longer one: the "n." at the
  // end of "ran." is not an initial.
  if (firstLetter > 0 && /[A-Za-z]/.test(text[firstLetter - 1] ?? "")) return null;

  return word;
}

/**
 * The word after an ender, past any space and any closing marks.
 *
 * null means there is nothing after it.
 */
function nextWord(text: string, from: number): string | null {
  let i = from;
  while (i < text.length && /\s/.test(text[i] ?? "")) i++;
  while (i < text.length && /[."'”’)\]]/.test(text[i] ?? "")) i++;
  if (i >= text.length) return null;
  let end = i;
  while (end < text.length && /[A-Za-z0-9]/.test(text[end] ?? "")) end++;
  return text.slice(i, end);
}

/** Whether what follows an ender looks like the start of a new sentence. */
function startsNewSentence(next: string | null): boolean {
  // Nothing follows, so whatever came before was the whole sentence.
  if (next === null) return true;
  return /^[A-Z]/.test(next);
}

/** Whether the mark at this position ends a sentence. */
function endsSentence(text: string, i: number): boolean {
  const mark = text[i];
  if (mark === "!" || mark === "?") return true;
  if (mark !== ".") return false;

  const before = text[i - 1] ?? "";
  const after = text[i + 1] ?? "";

  // A decimal point or a version number: 3.5, 1.2.3.
  if (/\d/.test(before) && /\d/.test(after)) return false;

  // An initial or a dotted abbreviation: J. Smith, a.m., e.g.
  if (dottedRun(text, i)) return false;

  // The word the full stop came after.
  let start = i;
  while (start > 0 && /[A-Za-z]/.test(text[start - 1] ?? "")) start--;
  const word = text.slice(start, i).toLowerCase();
  if (word === "") return true;

  // A title is always followed by a name.
  if (TITLE_ABBREVIATION.has(word)) return false;

  // These can end a sentence, but only if a new one starts after them.
  if (SOFT_ABBREVIATION.has(word)) return startsNewSentence(nextWord(text, i + 1));

  return true;
}

/**
 * Split Latin script into sentences.
 *
 * The closing marks belong to the sentence they close, and the text after a
 * sentence end is trimmed — a sentence never starts with a space.
 */
export function toSentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;

  for (let i = 0; i < text.length; i++) {
    if (!endsSentence(text, i)) continue;

    let end = i + 1;
    while (end < text.length && CLOSING.has(text[end] ?? "")) end++;
    // An ellipsis is one mark repeated, and belongs to the sentence.
    while (end < text.length && text[end] === ".") end++;

    const piece = text.slice(start, end).trim();
    if (piece) out.push(piece);
    start = end;
    i = end - 1;
  }

  const rest = text.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}
