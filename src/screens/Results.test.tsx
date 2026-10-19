// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { Outcome } from "../domain/types";
import { Results } from "./Results";

interface Mark {
  transcript: string;
  outcome: Outcome | null;
}

/** Marks live in the App, so the harness stands in for it. */
function Harness({ initial }: { initial: Mark[] }) {
  const [results, setResults] = useState(initial);
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
});
