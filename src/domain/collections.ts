import type { Collection, LanguageId, Mode } from "./types";

/**
 * The title a draft will be saved under. An untitled draft still needs a name,
 * because the title is the only handle a person has on a saved Collection.
 */
export function draftTitle(title: string, mode: Mode): string {
  return title.trim() || `Untitled ${mode}`;
}

/**
 * Whether two titles name the same saved Collection. Matching ignores
 * surrounding space and case: "Lesson 1" and " lesson 1 " are the same thing
 * to the person who typed them.
 */
export function sameTitle(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
}

export function findCollectionByTitle(collections: Collection[], title: string): Collection | null {
  return collections.find((c) => sameTitle(c.title, title)) ?? null;
}

/**
 * The Collection to persist for a draft.
 *
 * A title that is already saved overwrites that Collection in place — same
 * id, same createdAt — so drilling a sample again refreshes it instead of
 * piling up identical rows. A new title gets a fresh id.
 */
export function planCollectionSave(
  collections: Collection[],
  draft: { title: string; language: LanguageId; mode: Mode; text: string },
  now: number,
  mintId: () => string,
): Collection {
  const title = draftTitle(draft.title, draft.mode);
  const existing = findCollectionByTitle(collections, title);
  return {
    id: existing?.id ?? mintId(),
    title,
    language: draft.language,
    mode: draft.mode,
    text: draft.text,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}
