import { describe, expect, it } from "vitest";
import { draftTitle, findCollectionByTitle, planCollectionSave, sameTitle } from "./collections";
import type { Collection } from "./types";

function collection(over: Partial<Collection> = {}): Collection {
  return {
    id: "c1",
    title: "Lesson 1",
    language: "en",
    mode: "paragraph",
    text: "The weather is pleasant.",
    createdAt: 1000,
    updatedAt: 1000,
    ...over,
  };
}

describe("draftTitle", () => {
  it("uses the typed title", () => {
    expect(draftTitle("  Lesson 1 ", "vocab")).toBe("Lesson 1");
  });

  it("names an untitled draft after its mode", () => {
    expect(draftTitle("   ", "vocab")).toBe("Untitled vocab");
    expect(draftTitle("", "paragraph")).toBe("Untitled paragraph");
  });
});

describe("sameTitle", () => {
  it("ignores surrounding space and case", () => {
    expect(sameTitle(" Lesson 1 ", "lesson 1")).toBe(true);
  });

  it("separates different titles", () => {
    expect(sameTitle("Lesson 1", "Lesson 2")).toBe(false);
  });

  it("does not fold Chinese characters", () => {
    expect(sameTitle("圖書館", "图书馆")).toBe(false);
  });
});

describe("findCollectionByTitle", () => {
  it("finds the saved Collection with that title", () => {
    const a = collection({ id: "a", title: "Lesson 1" });
    const b = collection({ id: "b", title: "Lesson 2" });
    expect(findCollectionByTitle([a, b], " lesson 1 ")?.id).toBe("a");
  });

  it("returns null when nothing matches", () => {
    expect(findCollectionByTitle([collection()], "Lesson 9")).toBeNull();
  });
});

describe("planCollectionSave", () => {
  it("mints a fresh id when the title is new", () => {
    const planned = planCollectionSave(
      [collection({ id: "old", title: "Lesson 1" })],
      { title: "Lesson 2", language: "en", mode: "paragraph", text: "New text." },
      2000,
      () => "fresh",
    );
    expect(planned.id).toBe("fresh");
    expect(planned.createdAt).toBe(2000);
    expect(planned.updatedAt).toBe(2000);
  });

  it("overwrites a Collection with the same title, keeping its id and createdAt", () => {
    const planned = planCollectionSave(
      [collection({ id: "old", title: "Lesson 1", createdAt: 1000 })],
      { title: "Lesson 1", language: "en", mode: "paragraph", text: "Revised text." },
      2000,
      () => "fresh",
    );
    expect(planned).toEqual({
      id: "old",
      title: "Lesson 1",
      language: "en",
      mode: "paragraph",
      text: "Revised text.",
      createdAt: 1000,
      updatedAt: 2000,
    });
  });

  it("matches the title loosely, so re-saving a sample does not duplicate it", () => {
    const existing = [collection({ id: "sample", title: "Untitled vocab", mode: "vocab" })];
    const planned = planCollectionSave(
      existing,
      { title: "  untitled VOCAB ", language: "yue", mode: "vocab", text: "圖書館" },
      2000,
      () => "fresh",
    );
    expect(planned.id).toBe("sample");
  });

  it("treats a title-only match across Languages as the same Collection", () => {
    const existing = [collection({ id: "en", title: "Lesson 1", language: "en" })];
    const planned = planCollectionSave(
      existing,
      { title: "Lesson 1", language: "zh", mode: "paragraph", text: "今天天气不错。" },
      2000,
      () => "fresh",
    );
    expect(planned.id).toBe("en");
    expect(planned.language).toBe("zh");
  });
});
