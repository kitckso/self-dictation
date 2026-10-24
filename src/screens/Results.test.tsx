// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { ChunkResult } from "../domain/types";
import { Results } from "./Results";

type Mark = Omit<ChunkResult, "index">;

/** Marks live in the App, so the harness stands in for it. */
function Harness({ initial, chunks = ["圖書館", "醫院"] }: { initial: Mark[]; chunks?: string[] }) {
  const [results, setResults] = useState<ChunkResult[]>(() =>
    initial.map((r, index) => ({ ...r, index })),
  );
  return (
    <Results
      title="Lesson 1"
      language="zh"
      mode="vocab"
      chunks={chunks}
      results={results}
      onMark={(i, outcome) =>
        setResults((prev) => prev.map((r, j) => (j === i ? { ...r, outcome } : r)))
      }
      onAgain={() => {}}
      onSetup={() => {}}
      onHistory={() => {}}
    />
  );
}

/** Two Chunks written on paper, so both ask to be marked. */
const paper: Mark[] = [
  { transcript: "", outcome: null },
  { transcript: "", outcome: null },
];

/** The three self-mark buttons on the first paper Chunk. */
function markButtons() {
  return [
    screen.getAllByRole("button", { name: /✓ all/ })[0],
    screen.getAllByRole("button", { name: /~ some/ })[0],
    screen.getAllByRole("button", { name: /✗ wrong/ })[0],
  ];
}

afterEach(cleanup);

describe("Results", () => {
  it("reveals every Chunk, asks only the paper ones to be marked, and settles the score", () => {
    const { container } = render(
      <Harness
        initial={[
          { transcript: "圖書飯", outcome: null },
          { transcript: "", outcome: null },
        ]}
      />,
    );

    // Both References are on screen, typed and written-on-paper alike.
    expect(container.querySelectorAll(".res-item")).toHaveLength(2);
    expect(screen.getByText("醫院")).toBeTruthy();
    // The wrong character is flagged, not left to be spotted by eye.
    const wrong = container.querySelectorAll(".tok.miss");
    expect(wrong).toHaveLength(1);
    expect(wrong[0]?.textContent).toBe("館");

    // Only the paper Chunk asks to be self-marked.
    const marks = screen.getAllByRole("button", { name: /✓ all/ });
    expect(marks).toHaveLength(1);

    expect(screen.getByText("67%")).toBeTruthy(); // the typed Chunk alone
    fireEvent.click(marks[0]!);
    expect(screen.getByText("83%")).toBeTruthy(); // 2/3 typed, then all correct
  });

  it("reports which mark is set, not only which one is lit", () => {
    render(<Harness initial={paper} />);

    const [all, some] = markButtons();

    expect(all!.getAttribute("aria-pressed")).toBe("false");
    expect(some!.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(some!);

    expect(some!.getAttribute("aria-pressed")).toBe("true");
    expect(all!.getAttribute("aria-pressed")).toBe("false");
  });

  it("clears a mark when the same button is pressed again", () => {
    render(<Harness initial={paper} />);

    const [wrong] = markButtons();

    fireEvent.click(wrong!);
    expect(wrong!.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(wrong!);
    expect(wrong!.getAttribute("aria-pressed")).toBe("false");
  });

  it("leaves a typed Chunk unmarkable, because there is nothing to self-mark", () => {
    render(
      <Harness
        initial={[
          { transcript: "圖書館", outcome: null },
          { transcript: "醫院", outcome: null },
        ]}
      />,
    );

    expect(screen.queryByRole("button", { name: /✓ all/ })).toBeNull();
  });

  it("says so when nothing in the Run was answered, because it is not kept", () => {
    render(<Harness initial={paper} />);

    // A Run nobody answered is not a record of anything, so it is not kept.
    expect(screen.getByText(/not kept/i)).toBeTruthy();

    fireEvent.click(markButtons()[0]!);

    // Once something is answered the Run is worth keeping, and the note goes.
    expect(screen.queryByText(/not kept/i)).toBeNull();
  });

  it("marks a score right at the same point a Weakness is counted as wrong", () => {
    // Exactly at the threshold is still right. Results and Progress take the
    // figure from one place, but a second copy of it is exactly how they
    // would come to disagree.
    render(
      <Harness chunks={["圖書館館館"]} initial={[{ transcript: "圖書館館", outcome: null }]} />,
    );

    const score = screen.getByText("80%");

    expect(score.getAttribute("style")).toContain("--ok");
  });

  it("marks a score wrong below that same point", () => {
    render(<Harness chunks={["圖書館館館"]} initial={[{ transcript: "圖書館", outcome: null }]} />);

    const score = screen.getByText("60%");

    expect(score.getAttribute("style")).toContain("--bad");
  });
});
