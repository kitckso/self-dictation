// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { webSpeech } from "../tts";
import type { VoiceProfile } from "../voice/profile";
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

/**
 * The seam behind the voice-commands dialog.
 *
 * It is made by the app and handed over, so the test hands over a stand-in
 * rather than loading the real thing.
 */
const { voiceTrainer } = vi.hoisted(() => {
  // The same state every time: a snapshot that changes on every read would
  // send the store into a loop.
  const state = {
    profile: null,
    phrases: { next: "next", repeat: "repeat" },
    counts: { next: 0, repeat: 0 },
    noise: 0,
    enabled: false,
    stage: "names",
    busy: false,
    progress: null,
    test: null,
    heard: null,
    error: null,
    unsaved: false,
    phraseError: null,
  };
  const trainer = {
    subscribe: vi.fn(() => () => {}),
    getState: vi.fn(() => state),
    load: vi.fn(),
    discard: vi.fn(),
  };
  return { trainer, voiceTrainer: vi.fn(async () => trainer) };
});

vi.mock("../voice", () => ({ voiceTrainer }));

beforeEach(() => {
  vi.mocked(webSpeech.speak).mockResolvedValue("finished");
});

afterEach(cleanup);

/** A profile of the person's own commands. */
function voiceProfile(over: Partial<VoiceProfile> = {}): VoiceProfile {
  return {
    id: "p1",
    phrases: { next: "下一個", repeat: "再嚟一次" },
    counts: { next: 6, repeat: 6 },
    enabled: true,
    createdAt: 1_000,
    updatedAt: 2_000,
    trainedAt: 2_000,
    ...over,
  };
}

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
      onVoiceCommandsChanged={() => {}}
      voiceProfile={null}
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

  it("keeps the start button where it is when the share button appears", () => {
    renderSetup();

    fireEvent.click(screen.getByRole("button", { name: /load sample/i }));

    const start = screen.getByRole("button", { name: /start dictation/i });
    const share = screen.getByRole("button", { name: /share/i });
    const actions = start.parentElement;

    // Both live in the pinned bar and the Start button is last in it, so
    // revealing the Share button grows the bar upwards instead of pushing the
    // Start button down and out of reach.
    expect(actions?.className).toContain("setup-foot");
    expect(actions?.contains(share)).toBe(true);
    expect(actions?.lastElementChild).toBe(start);
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

describe("the voice commands card", () => {
  it("says the built-in words when nothing has been trained", () => {
    renderSetup();

    expect(screen.getByText(/the built-in english words/i)).toBeTruthy();
    expect(screen.getByText(/hears .go., .yes. and .no. out loud/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /teach it your own words/i })).toBeTruthy();
  });

  it("names the person's own words when they have trained some", () => {
    renderSetup({ voiceProfile: voiceProfile() });

    expect(screen.getByText(/下一個/)).toBeTruthy();
    expect(screen.getByText(/trained on 12 samples/i)).toBeTruthy();
    expect(screen.getByText("Your words")).toBeTruthy();
    expect(screen.getByRole("button", { name: /change the words/i })).toBeTruthy();
  });

  it("says so when the person's own words are switched off", () => {
    renderSetup({ voiceProfile: voiceProfile({ enabled: false }) });

    expect(screen.getByText("Switched off")).toBeTruthy();
    expect(screen.getByText(/still hears .go., .yes. and .no./i)).toBeTruthy();
  });

  it("opens the dialog when the card is tapped", async () => {
    renderSetup();

    fireEvent.click(screen.getByRole("button", { name: /teach it your own words/i }));

    expect(voiceTrainer).toHaveBeenCalled();
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole("dialog", { name: /voice commands/i })).toBeTruthy();
  });

  it("says so when the dialog cannot be opened, rather than doing nothing", async () => {
    vi.mocked(voiceTrainer).mockRejectedValueOnce(new Error("the model is not here"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    renderSetup();

    fireEvent.click(screen.getByRole("button", { name: /teach it your own words/i }));

    // The tap did something, and the person is told what.
    expect(await screen.findByText(/could not be opened on this device/i)).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: /voice commands/i })).toBeNull();

    logged.mockRestore();
  });
});
