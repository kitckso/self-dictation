export type LanguageId = "yue" | "zh" | "en";
export type Mode = "paragraph" | "vocab";

/**
 * How well a Chunk was answered.
 *
 * `correct` / `partial` / `wrong` exist because most people do NOT type their
 * answer — for Chinese especially, they write it on paper and then mark
 * themselves. Typed Transcripts get an automatic figure from Grading; paper
 * answers get an Outcome instead. See GLOSSARY.md.
 */
export type Outcome = "correct" | "partial" | "wrong";

export interface Language {
  id: LanguageId;
  label: string;
  /**
   * BCP-47 tags we accept when matching a device Voice, most compatible first.
   *
   * tags[0] is what gets handed to `utterance.lang`, so it must be a tag the
   * platform actually synthesises with — NOT the ISO 639-3 code. "yue" and
   * "cmn" are correct ISO codes but poorly supported as speech tags, and
   * requesting one makes the engine fall back to an unrelated voice.
   */
  tags: string[];
  /** What the user may need to install in system settings. */
  requires?: string;
}

export const LANGUAGES: Language[] = [
  { id: "yue", label: "Cantonese", tags: ["zh-HK", "yue"], requires: "a Cantonese (zh-HK) voice" },
  {
    id: "zh",
    label: "Mandarin",
    tags: ["zh-CN", "zh-Hans", "cmn"],
    requires: "a Chinese (zh-CN) voice",
  },
  { id: "en", label: "English", tags: ["en-GB", "en-US", "en"] },
];

export function languageById(id: LanguageId): Language {
  const found = LANGUAGES.find((l) => l.id === id);
  if (!found) throw new Error(`unknown language: ${id}`);
  return found;
}

/** Material the Setup screen starts with. */
export interface SetupFill {
  language: LanguageId;
  mode: Mode;
  title: string;
  text: string;
}

/** What Setup hands over to begin a Run. */
export interface StartInput extends SetupFill {
  /** Null when the browser could not save the Collection. */
  collectionId: string | null;
}

export interface Collection {
  id: string;
  title: string;
  language: LanguageId;
  mode: Mode;
  text: string;
  createdAt: number;
  updatedAt: number;
}

export interface ChunkResult {
  index: number;
  /** What the person typed, if anything. Optional by design. */
  transcript: string;
  outcome: Outcome | null;
}

export interface Run {
  id: string;
  collectionId: string | null;
  title: string;
  language: LanguageId;
  mode: Mode;
  chunks: string[];
  results: ChunkResult[];
  startedAt: number;
  finishedAt: number | null;
}

export const OUTCOME_WEIGHT: Record<Outcome, number> = {
  correct: 1,
  partial: 0.5,
  wrong: 0,
};
