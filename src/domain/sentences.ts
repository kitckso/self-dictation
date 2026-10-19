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
  "jr",
  "sr",
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
 * Dotted abbreviations that can stand at the end of a sentence.
 *
 * A dotted run can also be a person's initials — "J.R.R. Tolkien" — which a
 * name follows just as it follows a title. There is no way to tell the two
 * shapes apart, so only the ones that really are abbreviations are allowed to
 * end a sentence; an unknown run stays with what follows it.
 */
const DOTTED_ABBREVIATION = new Set([
  "us",
  "usa",
  "uk",
  "un",
  "eu",
  "am",
  "pm",
  "ad",
  "bc",
  "bce",
  "ce",
  "eg",
  "ie",
  "aka",
  "phd",
  "msc",
  "bsc",
]);

/** What a full stop in a dotted run turned out to belong to. */
interface DottedRun {
  /** The run as written, dots included — "U.S.", "Ph.D.", "J.". */
  word: string;
  /** The index of the last dot in the run; only that one can end a sentence. */
  lastDot: number;
  /** A single capital is an initial, which never ends a sentence. */
  initial: boolean;
  /** Whether this run is an abbreviation that can end a sentence. */
  canEnd: boolean;
}

/**
 * The dotted word a full stop belongs to, or null.
 *
 * "a.m." is one abbreviation spread over two dots, so the run has to be taken
 * as a whole: the first dot of it is decided by the second. Components may be
 * one to three letters, so "Ph.D." and "M.Sc." count as dotted words too.
 * A single capital on its own is an initial: "J. Smith" stays together, but
 * "I said a." ends a sentence because "a" is not capital.
 */
function dottedRun(text: string, dot: number): DottedRun | null {
  // A run is letters and dots with nothing between: spaces and other
  // punctuation end it. Taking the whole token, rather than stepping over
  // single-letter pairs, is what lets a component be longer than one letter.
  let start = dot;
  while (start > 0 && /[A-Za-z.]/.test(text[start - 1] ?? "")) start--;
  let end = dot + 1;
  while (end < text.length && /[A-Za-z.]/.test(text[end] ?? "")) end++;

  const word = text.slice(start, end);
  if (!word.endsWith(".")) return null;

  const initial = /^[A-Z]\.$/.test(word);
  const dotted = /^(?:[A-Za-z]{1,3}\.){2,}$/.test(word);
  if (!initial && !dotted) {
    // A lowercase single letter is a word, not an initial: "I said a." is a
    // sentence end, so leave it to the ordinary path.
    return null;
  }

  // Only the final dot of the run can end a sentence; the earlier ones are
  // inside it. For an initial the last dot is also the only one.
  const lastDot = end - 1;
  const bare = word.replaceAll(".", "").toLowerCase();

  return {
    word,
    lastDot,
    initial,
    canEnd: !initial && DOTTED_ABBREVIATION.has(bare),
  };
}

/** The word immediately before `start`, or "" if there is none. */
function wordBefore(text: string, start: number): string {
  let end = start - 1;
  while (end >= 0 && !/[A-Za-z]/.test(text[end] ?? "")) end--;
  let begin = end;
  while (begin >= 0 && /[A-Za-z]/.test(text[begin] ?? "")) begin--;
  return text.slice(begin + 1, end + 1);
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
  const run = dottedRun(text, i);
  if (run) {
    // Inside an abbreviation, every dot but the last is decided by the run.
    if (i !== run.lastDot) return false;
    // A run that cannot end a sentence — an initial, or an unknown name-like
    // acronym — keeps the word after it.
    if (!run.canEnd) return false;
    return startsNewSentence(nextWord(text, i + 1));
  }

  // The word the full stop came after.
  let start = i;
  while (start > 0 && /[A-Za-z]/.test(text[start - 1] ?? "")) start--;
  const word = text.slice(start, i).toLowerCase();
  if (word === "") return true;

  // A title is always followed by a name.
  if (TITLE_ABBREVIATION.has(word)) return false;

  // "St." is Street after a name (Main St. Then...) and Saint before one
  // (St. John). Only the street reading can end a sentence.
  if (word === "st") {
    if (!/^[A-Z]/.test(wordBefore(text, start))) return false;
    return startsNewSentence(nextWord(text, i + 1));
  }

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

    // Closing marks and the dots of an ellipsis both belong to the sentence,
    // and may alternate: "Wait..." closes after the dots, not before them.
    let end = i + 1;
    while (end < text.length && (CLOSING.has(text[end] ?? "") || text[end] === ".")) end++;

    const piece = text.slice(start, end).trim();
    if (piece) out.push(piece);
    start = end;
    i = end - 1;
  }

  const rest = text.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}
