import type { SpeakOptions, TtsProvider, VoiceOption } from "./TtsProvider";

/**
 * Web Speech (speechSynthesis) — free, offline, no key, no server.
 *
 * Three documented failure modes are worked around here:
 *
 * 1. getVoices() returns [] on first call in Chrome and Safari. We wait for
 *    `voiceschanged`.
 * 2. Chrome silently stops mid-utterance at ~15s for network voices and fires
 *    NO events — no error, no end — leaving `speaking` true forever
 *    (crbug.com/41294170). We run a watchdog and a pause/resume keepalive.
 * 3. `boundary` events never fire for network-backed voices (41195426), so
 *    onBoundary is best-effort and nothing depends on it.
 *
 * Chunks are kept short upstream so (2) rarely triggers at all.
 */

/** Past this, assume Chrome has silently stopped. */
const WATCHDOG_MS = 20_000;
/** The known-good cutoff for Chrome network voices. */
const KEEPALIVE_MS = 12_000;

/** Rough speech rate, used only to size the watchdog. */
const CHARS_PER_SECOND = 4.5;

function synth(): SpeechSynthesis | null {
  return typeof window !== "undefined" && "speechSynthesis" in window
    ? window.speechSynthesis
    : null;
}

export function isSupported(): boolean {
  return synth() !== null;
}

function toOptions(voices: SpeechSynthesisVoice[]): VoiceOption[] {
  return voices.map((v) => ({
    id: v.voiceURI,
    label: v.name,
    lang: v.lang,
    local: v.localService,
  }));
}

/**
 * The device's voice list, read once.
 *
 * `speak()` needs a voice on every utterance and `listVoices` on setup, so
 * without this each one would re-read the list — and on the slow path that
 * means stacking another `voiceschanged` listener and another two-second timer
 * per utterance. The list only changes when the platform says so, so it is
 * cached and dropped when `voiceschanged` fires.
 */
let voicesCache: SpeechSynthesisVoice[] | null = null;
let voicesRead: Promise<SpeechSynthesisVoice[]> | null = null;
/** The platform's change-notice listener, attached once for the page's life. */
let watching = false;

function invalidateVoices(): void {
  voicesCache = null;
  voicesRead = null;
}

/**
 * Installing or removing a language pack changes the list long after setup, so
 * one listener lives for the page rather than a fresh one per read. This is the
 * opposite trade to the per-read listener it replaced: that was N listeners and
 * N timeouts per burst of utterances, this is one of each.
 */
function watchForChanges(): void {
  if (watching) return;
  const s = synth();
  if (!s) return;
  watching = true;
  s.addEventListener("voiceschanged", invalidateVoices);
}

function getVoices(): Promise<SpeechSynthesisVoice[]> {
  if (voicesCache) return Promise.resolve(voicesCache);
  // A read is already under way: share it rather than start a second.
  if (voicesRead) return voicesRead;

  const s = synth();
  if (!s) return Promise.resolve([]);

  watchForChanges();

  const immediate = s.getVoices();
  if (immediate.length > 0) {
    voicesCache = immediate;
    return Promise.resolve(immediate);
  }

  const pending: Promise<SpeechSynthesisVoice[]> = new Promise<SpeechSynthesisVoice[]>(
    (resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const done = () => {
        clearTimeout(timer);
        s.removeEventListener("voiceschanged", done);
        const found = s.getVoices();
        voicesCache = found;
        resolve(found);
      };
      s.addEventListener("voiceschanged", done);
      // Safari occasionally never fires it; don't hang the UI forever.
      timer = setTimeout(done, 2000);
    },
  ).finally(() => {
    if (voicesRead === pending) voicesRead = null;
  });

  voicesRead = pending;
  return pending;
}

/**
 * Pick the best device voice for a language.
 *
 * Android Chrome reports language codes rather than installed voices, so a
 * "found" result there is optimistic — it means the browser *might* be able to
 * speak it, not that it can. Callers must tolerate a Voice that is unusable.
 */
export function pickVoice(
  voices: SpeechSynthesisVoice[],
  lang: string,
): SpeechSynthesisVoice | null {
  const wanted = lang.toLowerCase();
  const base = wanted.split(/[-_]/)[0] ?? wanted;
  const byLang = voices.filter((v) => v.lang.toLowerCase().replace(/_/g, "-").startsWith(wanted));
  if (byLang.length > 0) return byLang.find((v) => v.localService) ?? byLang[0] ?? null;
  const byBase = voices.filter(
    (v) => v.lang.toLowerCase().replace(/_/g, "-").split("-")[0] === base,
  );
  return byBase.find((v) => v.localService) ?? byBase[0] ?? null;
}

/**
 * Chrome on Android reports a voice entry for every locale the platform knows
 * about, not the ones actually installed. Picking one of those gives an
 * utterance that silently produces no sound, so on Android we only trust
 * voices flagged as local and otherwise leave `utterance.voice` unset and let
 * the browser choose from what it has genuinely installed.
 *
 * Android also cannot be trusted to tell us what it has: `getVoices()` may
 * return `[]` even when voices exist. An empty list means "we can't see", not
 * "there are none" — callers must say so rather than claim there is no voice.
 */
function chooseVoice(voices: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;
  const match = pickVoice(voices, lang);
  if (!match) return null;
  if (isAndroidLike() && !match.localService) return null;
  return match;
}

const ANDROID = /android/i;

export function isAndroidLike(): boolean {
  return typeof navigator !== "undefined" && ANDROID.test(navigator.userAgent);
}

class WebSpeechProvider implements TtsProvider {
  readonly id = "web-speech";
  private timers: ReturnType<typeof setTimeout>[] = [];
  /** True when the current utterance was stopped on purpose by us. */
  private stopped = false;

  async listVoices(): Promise<VoiceOption[]> {
    return toOptions(await getVoices());
  }

  /** False when the browser gives us no voice list at all (typical on Android). */
  async canEnumerateVoices(): Promise<boolean> {
    return (await getVoices()).length > 0;
  }

  speak(text: string, options: SpeakOptions): Promise<void> {
    const s = synth();
    if (!s) return Promise.resolve();

    this.cancel();
    this.stopped = false;

    return new Promise<void>((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = options.lang;
      // The platform clamps to [0.1, 10] itself; writing the range down says so
      // out loud, and a falsy check would quietly drop a rate of 0.
      if (options.rate !== undefined) {
        utterance.rate = Math.min(10, Math.max(0.1, options.rate));
      }

      void getVoices().then((voices) => {
        const voice = chooseVoice(voices, options.lang);
        if (voice) utterance.voice = voice;
      });

      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        this.clearTimers();
        resolve();
      };

      utterance.onend = finish;
      utterance.onerror = (e) => {
        // Stopping playback on purpose is not a failure. The platform still
        // fires `error` with "canceled"/"interrupted", and reporting that as
        // a speech failure would be a lie the user has to see and dismiss.
        const benign = e.error === "canceled" || e.error === "interrupted";
        if (!benign && !this.stopped) options.onError?.(e.error || "speech-failed");
        finish();
      };
      if (options.onBoundary) {
        utterance.onboundary = (e) => options.onBoundary?.(e.charIndex);
      }

      // Workaround (2): assume the worst and resolve either way.
      const estimate = Math.max(3000, (text.length / CHARS_PER_SECOND) * 1000);
      const timers = [setTimeout(finish, estimate + WATCHDOG_MS)];

      // Workaround (2): nudge Chrome so it doesn't hit its ~15s cutoff.
      // This MUST be skipped on Android — pause/resume is what breaks
      // Android speech, it does not help it (crbug.com/41294170).
      if (!isAndroidLike()) {
        timers.push(
          setInterval(() => {
            if (!s.speaking) return;
            s.pause();
            s.resume();
          }, KEEPALIVE_MS),
        );
      }
      this.timers.push(...timers);

      s.speak(utterance);
    });
  }

  cancel(): void {
    this.stopped = true;
    this.clearTimers();
    const s = synth();
    if (s) s.cancel();
  }

  private clearTimers(): void {
    for (const t of this.timers) {
      clearTimeout(t);
      clearInterval(t);
    }
    this.timers = [];
  }
}

export const webSpeech = new WebSpeechProvider();
