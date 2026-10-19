import { describe, expect, it } from "vitest";
import { toSentences } from "./sentences";

describe("toSentences", () => {
  it("splits on a sentence end", () => {
    expect(toSentences("Hello there. How are you?")).toEqual(["Hello there.", "How are you?"]);
  });

  it("splits on an exclamation mark", () => {
    expect(toSentences("Come here! Now.")).toEqual(["Come here!", "Now."]);
  });

  it("keeps a title and the name that follows it together", () => {
    // A full stop after "Mr." is the end of the title, not of the sentence.
    expect(toSentences("Mr. Smith went home.")).toEqual(["Mr. Smith went home."]);
    expect(toSentences("Dr. Chen called at nine.")).toEqual(["Dr. Chen called at nine."]);
    expect(toSentences("Prof. Lee teaches it.")).toEqual(["Prof. Lee teaches it."]);
  });

  it("keeps a decimal point inside its number", () => {
    expect(toSentences("The price is 3.5 dollars.")).toEqual(["The price is 3.5 dollars."]);
    expect(toSentences("It weighs 1.2 kg.")).toEqual(["It weighs 1.2 kg."]);
  });

  it("keeps a dotted abbreviation together", () => {
    // "a.m." is one abbreviation spread over two dots, and the first dot is
    // decided by the second.
    expect(toSentences("Dr. Chen called at 9 a.m. today.")).toEqual([
      "Dr. Chen called at 9 a.m. today.",
    ]);
    expect(toSentences("Use red, e.g. the one on the left.")).toEqual([
      "Use red, e.g. the one on the left.",
    ]);
  });

  it("keeps initials with the name that follows them", () => {
    expect(toSentences("J. R. Tolkien wrote it.")).toEqual(["J. R. Tolkien wrote it."]);
  });

  it("treats a single capital letter as an initial but a small one as a word", () => {
    // "a." at the end of a sentence is a word, not an initial.
    expect(toSentences("I said a. Then we left.")).toEqual(["I said a.", "Then we left."]);
  });

  it("treats a two-letter word as a word, not an initial", () => {
    expect(toSentences("She said no. Then she left.")).toEqual(["She said no.", "Then she left."]);
  });

  it("lets an abbreviation end a sentence when a new one follows", () => {
    expect(toSentences("I like cats, etc.")).toEqual(["I like cats, etc."]);
    expect(toSentences("Pick one, etc. Then move on.")).toEqual([
      "Pick one, etc.",
      "Then move on.",
    ]);
  });

  it("keeps an abbreviation inside a sentence when a small word follows", () => {
    expect(toSentences("Use red, etc. for now.")).toEqual(["Use red, etc. for now."]);
  });

  it("keeps a figure reference with its number", () => {
    expect(toSentences("See fig. 2 for details.")).toEqual(["See fig. 2 for details."]);
  });

  it("splits a full stop with no space after it", () => {
    // The lookbehind split cannot see this one, but it is still a sentence end.
    expect(toSentences("end.Next follows")).toEqual(["end.", "Next follows"]);
  });

  it("keeps the closing quote with the sentence it closes", () => {
    expect(toSentences('"Hi." She left.')).toEqual(['"Hi."', "She left."]);
  });

  it("keeps an ellipsis together rather than chopping it up", () => {
    // An ellipsis is one pause, and belongs to the sentence it ends.
    expect(toSentences("Wait... what now?")).toEqual(["Wait...", "what now?"]);
  });

  it("splits a numbered list into its items", () => {
    expect(toSentences("Chapter 1. Chapter 2. Chapter 3.")).toEqual([
      "Chapter 1.",
      "Chapter 2.",
      "Chapter 3.",
    ]);
  });

  it("leaves a passage with no sentence end as one piece", () => {
    expect(toSentences("no full stop here")).toEqual(["no full stop here"]);
  });

  it("copes with an empty passage", () => {
    expect(toSentences("")).toEqual([]);
    expect(toSentences("   ")).toEqual([]);
  });

  it("splits a real passage into its sentences", () => {
    const passage =
      "The weather is unusually pleasant this morning. I had planned to walk along " +
      "the harbour after lunch, but the wind came up at 3.5 knots and Mr. Sun arrived " +
      "at the pier just as I did. He said it would clear by noon!";

    expect(toSentences(passage)).toEqual([
      "The weather is unusually pleasant this morning.",
      "I had planned to walk along the harbour after lunch, but the wind came up at 3.5 knots " +
        "and Mr. Sun arrived at the pier just as I did.",
      "He said it would clear by noon!",
    ]);
  });
});
