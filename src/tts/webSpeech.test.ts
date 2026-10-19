// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

type Listener = () => void;

/**
 * Just enough of SpeechSynthesis to watch how often the provider reaches for it.
 *
 * The bug this guards against is invisible from the outside: a burst of
 * utterances reads the voice list once per utterance and, on the slow path,
 * leaves a `voiceschanged` listener and a two-second timer behind each time.
 */
class FakeSynth {
  voices: SpeechSynthesisVoice[] = [];
  /** How many times getVoices() was actually called. */
  reads = 0;
  speak = vi.fn();
  cancel = vi.fn();
  pause = vi.fn();
  resume = vi.fn();
  speaking = false;

  private listeners = new Map<string, Set<Listener>>();

  getVoices(): SpeechSynthesisVoice[] {
    this.reads++;
    return this.voices;
  }

  addEventListener(type: string, fn: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(fn);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, fn: Listener): void {
    this.listeners.get(type)?.delete(fn);
  }

  /** Simulate the platform announcing that its voice list changed. */
  announce(): void {
    // Copied first: a listener that resolves its wait takes itself off the set
    // while we are still walking it.
    const waiting = this.listeners.get("voiceschanged");
    if (!waiting) return;
    for (const fn of Array.from(waiting)) fn();
  }

  get listenerCount(): number {
    return this.listeners.get("voiceschanged")?.size ?? 0;
  }
}

function voice(name: string, lang: string): SpeechSynthesisVoice {
  return { voiceURI: name, name, lang, localService: true, default: false } as SpeechSynthesisVoice;
}

let synth: FakeSynth;

/** A fresh module each time, because the cached list is module state. */
async function provider() {
  vi.resetModules();
  return (await import("./webSpeech")).webSpeech;
}

beforeEach(() => {
  synth = new FakeSynth();
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
});

describe("the voice list", () => {
  it("is read once, however many times it is asked for", async () => {
    synth.voices = [voice("Siri", "en-GB")];
    const webSpeech = await provider();

    await webSpeech.listVoices();
    await webSpeech.listVoices();
    await webSpeech.canEnumerateVoices();

    expect(synth.reads).toBe(1);
  });

  it("keeps one change listener however many times it is asked for", async () => {
    synth.voices = [voice("Siri", "en-GB")];
    const webSpeech = await provider();

    await webSpeech.listVoices();
    await webSpeech.listVoices();
    await webSpeech.listVoices();

    expect(synth.listenerCount).toBe(1);
  });

  it("reads again once the platform says the list changed", async () => {
    synth.voices = [voice("Siri", "en-GB")];
    const webSpeech = await provider();
    expect(await webSpeech.listVoices()).toHaveLength(1);

    // A language pack installed after setup: the cached list is now a lie.
    synth.voices = [voice("Siri", "en-GB"), voice("Sinji", "zh-HK")];
    synth.announce();

    expect(await webSpeech.listVoices()).toHaveLength(2);
  });

  it("shares one slow read rather than stacking a listener per caller", async () => {
    // Chrome and Safari hand back [] on the first call of a session.
    const webSpeech = await provider();

    const first = webSpeech.listVoices();
    const second = webSpeech.canEnumerateVoices();
    // The watcher plus one shared wait — not a second wait for the second caller.
    expect(synth.listenerCount).toBe(2);

    // Now the list turns up, and both callers must see it.
    synth.voices = [voice("Siri", "en-GB")];
    synth.announce();

    expect((await first).length).toBeGreaterThan(0);
    expect(await second).toBe(true);
  });

  it("cleans up its one-shot listener once a slow read resolves", async () => {
    const webSpeech = await provider();
    const waiting = webSpeech.listVoices();
    expect(synth.listenerCount).toBe(2); // the watcher plus the one-shot wait

    synth.voices = [voice("Siri", "en-GB")];
    synth.announce();
    await waiting;

    // Only the permanent watcher is left; the wait must not linger.
    expect(synth.listenerCount).toBe(1);
  });

  it("gives up on the wait rather than hanging when the event never comes", async () => {
    vi.useFakeTimers();
    try {
      const webSpeech = await provider();
      const waiting = webSpeech.listVoices();

      await vi.advanceTimersByTimeAsync(2000);

      // Nothing ever arrived, so the answer is an empty list — "we cannot see",
      // which is what callers are told to say out loud.
      expect(await waiting).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers that voices cannot be enumerated when the list stays empty", async () => {
    const webSpeech = await provider();

    expect(await webSpeech.canEnumerateVoices()).toBe(false);
  });

  it("reads the list again later, once an empty one has gone stale", async () => {
    vi.useFakeTimers();
    try {
      const webSpeech = await provider();

      // Nothing ever arrives, and the wait gives up.
      const first = webSpeech.listVoices();
      await vi.advanceTimersByTimeAsync(2000);
      expect(await first).toEqual([]);

      // Straight away it is remembered, so a burst of utterances does not each
      // wait two seconds for nothing.
      const remembered = synth.reads;
      await webSpeech.listVoices();
      expect(synth.reads).toBe(remembered);

      // But an empty list is not believed for the life of the page. A voice
      // installed after setup has to be found without a reload.
      synth.voices = [voice("Siri", "en-GB")];
      await vi.advanceTimersByTimeAsync(30_000);

      const again = webSpeech.listVoices();
      await vi.advanceTimersByTimeAsync(2000);

      expect(await again).toHaveLength(1);
      expect(synth.reads).toBeGreaterThan(remembered);
    } finally {
      vi.useRealTimers();
    }
  });
});

/** The parts of an utterance the provider reaches for. */
type FakeUtterance = {
  onend: (() => void) | null;
  onerror: ((e: unknown) => void) | null;
  onboundary: ((e: unknown) => void) | null;
};

describe("speaking", () => {
  /** The utterances the provider handed the platform. */
  let utterances: FakeUtterance[];

  beforeEach(() => {
    utterances = [];
    class FakeUtterance {
      lang = "";
      rate = 1;
      voice: unknown = null;
      onend: (() => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onboundary: ((e: unknown) => void) | null = null;
      text: string;
      constructor(text: string) {
        this.text = text;
        utterances.push(this);
      }
    }
    Object.defineProperty(globalThis, "SpeechSynthesisUtterance", {
      value: FakeUtterance,
      configurable: true,
    });
  });

  it("reports a voice that finished", async () => {
    const webSpeech = await provider();

    const speaking = webSpeech.speak("Hello", { lang: "en-GB" });
    utterances[0]?.onend?.();

    expect(await speaking).toBe("finished");
  });

  it("reports a voice the platform cut short", async () => {
    vi.useFakeTimers();
    try {
      const webSpeech = await provider();

      const speaking = webSpeech.speak("Hello", { lang: "en-GB" });
      // The platform stops without a word, and the watchdog notices.
      await vi.advanceTimersByTimeAsync(60_000);

      expect(await speaking).toBe("cut-off");
    } finally {
      vi.useRealTimers();
    }
  });

  it("is not cut off by the watchdog when the voice finishes first", async () => {
    vi.useFakeTimers();
    try {
      const webSpeech = await provider();

      const speaking = webSpeech.speak("Hello", { lang: "en-GB" });
      utterances[0]?.onend?.();

      expect(await speaking).toBe("finished");
    } finally {
      vi.useRealTimers();
    }
  });
});
