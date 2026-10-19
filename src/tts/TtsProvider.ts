export interface VoiceOption {
  id: string;
  label: string;
  lang: string;
  local: boolean;
}

export interface SpeakOptions {
  /** BCP-47 tag of the voice to prefer. */
  lang: string;
  rate?: number;
  onBoundary?: (charIndex: number) => void;
  /** Fired when the platform refuses or fails to speak. */
  onError?: (reason: string) => void;
}

/**
 * How a piece of speech ended.
 *
 * "finished" means the platform said the utterance was over. "cut-off" means
 * it stopped without finishing — the words may not all have been spoken — and
 * "failed" means it never spoke at all: there is no speech support, or the
 * platform refused. Saying so is better than reporting a success that did not
 * happen.
 */
export type SpeakResult = "finished" | "cut-off" | "failed";

/**
 * The seam between the app and whatever actually makes sound.
 *
 * Only Web Speech ships today. The seam exists because Web Speech has known
 * failure modes (see webSpeech.ts) and Google has no guarantee of stability
 * across browsers, so any replacement belongs behind this interface rather than
 * threaded through the screens.
 */
export interface TtsProvider {
  readonly id: string;
  listVoices(): Promise<VoiceOption[]>;
  /**
   * Whether the browser will tell us its voice list at all. `false` means
   * "unknowable" — NOT "no voices". Chrome on Android usually returns an empty
   * list even when voices are installed, so availability cannot be inferred
   * from it there.
   */
  canEnumerateVoices(): Promise<boolean>;
  /**
   * Resolves when speech finishes, or when the provider gives up waiting.
   *
   * The result says which of the three happened, so a caller can tell a voice
   * that worked from one the platform cut short, and both from one that never
   * spoke. Only "finished" is a success.
   */
  speak(text: string, options: SpeakOptions): Promise<SpeakResult>;
  cancel(): void;
}
