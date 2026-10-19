// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { ChunkResult } from "../domain/types";
import { Results } from "./Results";

type Mark = Omit<ChunkResult, "index">;

/** Marks live in the App, so the harness stands in for it. */
function Harness({ initial }: { initial: Mark[] }) {
  const [results, setResults] = useState<ChunkResult[]>(() =>
    initial.map((r, index) => ({ ...r, index })),
  );
  return (
    <Results
      title="Lesson 1"
      language="zh"
      mode="vocab"
      chunks={["圖書館", "醫院"]}
      results={results}
      onMark={(i, outcome) =>
        setResults((prev) => prev.map((r, j) => (j === i ? { ...r, outcome } : r)))
      }
      onAgain={() => {}}
      onSetup={() => {}}
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
});
