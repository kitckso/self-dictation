// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { webSpeech } from "../tts";
import { Setup } from "./Setup";

vi.mock("../tts", () => ({
  isSupported: () => true,
  webSpeech: {
    speak: vi.fn().mockResolvedValue("finished"),
    cancel: vi.fn(),
    listVoices: vi.fn(),
  },
}));

vi.mock("../storage/db", () => ({
  listCollections: vi.fn().mockResolvedValue([]),
  saveCollection: vi.fn().mockResolvedValue(undefined),
  deleteCollection: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  vi.mocked(webSpeech.speak).mockResolvedValue("finished");
});

afterEach(cleanup);

function renderSetup(props: Partial<Parameters<typeof Setup>[0]> = {}) {
  return render(
    <Setup
      onStart={() => {}}
      onHistory={() => {}}
      voices={[]}
      canEnumerate={false}
      initial={null}
      fromLink={false}
      shareBroken={false}
      onStorageFail={() => {}}
      {...props}
    />,
  );
}

describe("Setup", () => {
  it("opens a dictation that arrived in a link", () => {
    const { container } = renderSetup({
      initial: { language: "zh", mode: "vocab", title: "生字", text: "圖書館\n醫院" },
      fromLink: true,
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

  it("says the voice played when it did", async () => {
    renderSetup();

    fireEvent.click(screen.getByRole("button", { name: /test this voice/i }));

    expect(await screen.findByText(/finished playing/i)).toBeTruthy();
  });

  it("does not claim the voice played when the browser cut it short", async () => {
    // Chrome stops speaking at around fifteen seconds without saying so, and
    // "Finished playing." for a voice that never got going would be a lie.
    vi.mocked(webSpeech.speak).mockResolvedValue("cut-off");
    renderSetup();

    fireEvent.click(screen.getByRole("button", { name: /test this voice/i }));

    expect(await screen.findByText(/stopped before it had finished/i)).toBeTruthy();
    expect(screen.queryByText(/finished playing/i)).toBeNull();
  });

  it("says the browser refused when speech failed outright", async () => {
    // A browser with no speech support, or one that rejects the utterance, has
    // not played anything.
    vi.mocked(webSpeech.speak).mockResolvedValue("failed");
    renderSetup();

    fireEvent.click(screen.getByRole("button", { name: /test this voice/i }));

    expect(await screen.findByText(/refused to speak/i)).toBeTruthy();
    expect(screen.queryByText(/finished playing/i)).toBeNull();
  });

  it("ignores an older test that settles after a newer one", async () => {
    // The first test belongs to the old Language. Changing the Language and
    // starting a second test must not let the first answer for it.
    const settle: ((result: "finished" | "cut-off" | "failed") => void)[] = [];
    vi.mocked(webSpeech.speak).mockImplementation(
      () => new Promise((resolve) => settle.push(resolve)),
    );
    renderSetup();

    fireEvent.click(screen.getByRole("button", { name: /test this voice/i }));
    fireEvent.click(screen.getByRole("button", { name: /Mandarin/ }));
    fireEvent.click(screen.getByRole("button", { name: /test this voice/i }));

    await act(async () => {
      settle[1]?.("finished");
    });

    await act(async () => {
      settle[0]?.("cut-off");
    });

    expect(screen.getByText(/finished playing/i)).toBeTruthy();
    expect(screen.queryByText(/stopped before it had finished/i)).toBeNull();
  });
});
