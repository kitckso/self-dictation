// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Setup } from "./Setup";

vi.mock("../tts", () => ({
  isSupported: () => true,
  webSpeech: { speak: vi.fn().mockResolvedValue(undefined), cancel: vi.fn(), listVoices: vi.fn() },
}));

vi.mock("../storage/db", () => ({
  listCollections: vi.fn().mockResolvedValue([]),
  saveCollection: vi.fn().mockResolvedValue(undefined),
  deleteCollection: vi.fn().mockResolvedValue(undefined),
}));

afterEach(cleanup);

function renderSetup(props: Partial<Parameters<typeof Setup>[0]> = {}) {
  return render(<Setup onStart={() => {}} voices={[]} canEnumerate={false} {...props} />);
}

describe("Setup", () => {
  it("opens a dictation that arrived in a link", () => {
    const { container } = renderSetup({
      shared: { language: "zh", mode: "vocab", title: "生字", text: "圖書館\n醫院" },
    });

    expect(screen.getByRole("button", { name: /Mandarin/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "Vocabulary" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByDisplayValue("生字")).toBeTruthy();
    expect(container.querySelector("textarea")?.value).toBe("圖書館\n醫院");
    expect(screen.getByText(/opened from a shared link/i)).toBeTruthy();
  });

  it("starts from the usual defaults when nothing was shared", () => {
    renderSetup();

    expect(screen.getByRole("button", { name: /Cantonese/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.queryByText(/shared link/i)).toBeNull();
  });

  it("says so when a shared link could not be read", () => {
    renderSetup({ shareBroken: true });

    expect(screen.getByText(/could not be read/i)).toBeTruthy();
  });

  it("offers the link and the code for what has been set up", async () => {
    renderSetup();
    fireEvent.change(screen.getByPlaceholderText(/paste a passage/i), {
      target: { value: "今日天氣唔錯。我打算去公園散步。" },
    });

    fireEvent.click(screen.getByRole("button", { name: /share/i }));

    expect(await screen.findByDisplayValue(/self-dictation\.netlify\.app\/#d=/)).toBeTruthy();
  });

  it("has nothing to share until there is something to dictate", () => {
    renderSetup();

    expect(screen.queryByRole("button", { name: /share/i })).toBeNull();
  });
});
