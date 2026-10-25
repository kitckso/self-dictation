import { newId } from "../lib/id";
import {
  deleteVoiceProfile,
  getVoiceHead,
  getVoiceProfile,
  renameVoiceProfile,
  saveVoiceProfile,
} from "../storage/db";
import { bestLabel, COMMAND_CONFIDENCE } from "./commands";
import { describeCommandError } from "./errors";
import type { VoiceHead } from "./head";
import { ensureMicrophone, RAW_MICROPHONE } from "./microphone";
import {
  defaultPhrases,
  emptyCounts,
  nextToRecord,
  NOISE_LABEL,
  phraseProblem,
  TRAIN_EPOCHS,
  type RecordingTarget,
  type VoiceCommandKey,
  type VoiceCounts,
  type VoicePhrases,
  type VoiceProfile,
} from "./profile";
import {
  recognizerForListening,
  resetRecognizers,
  setRecognizer,
  type ListeningRecognizer,
} from "./recognizer";
import type { SampleCollector, TrainResult } from "./trainer";

/**
 * Teaching the app a person's own commands.
 *
 * This is the seam the dialog talks to: everything about training — the
 * microphone, the model, the store — happens behind it, and the dialog only
 * has to show what is going on and ask for the next thing.
 *
 * The samples live here and nowhere else. Nothing is written to the store
 * until a trained head exists, and then only the head is written.
 */

/** Where the dialog is in its own flow. */
export type TrainerStage = "names" | "record" | "train" | "test" | "saved";

export interface VoiceTrainerOptions {
  /**
   * How to open a set of samples.
   *
   * The real one loads the speech model, which is why it is only loaded when
   * somebody actually starts recording. A test hands over a stand-in instead.
   */
  openSession?: () => Promise<SampleCollector>;
  /**
   * How to ask for the microphone.
   *
   * The real one makes the browser prompt. A test says yes without a
   * browser, because a refusal is not what the test is about.
   */
  askMicrophone?: () => Promise<void>;
  /**
   * How to build the recognizer a Run will listen with, from a trained head.
   *
   * The real one rebuilds the head onto the base model, which is what a
   * reload does. A test hands over a stand-in instead.
   */
  buildRecognizer?: (head: VoiceHead) => Promise<ListeningRecognizer>;
  /**
   * The pause between two samples of a recording that carries on.
   *
   * It is long enough for the tail of one word not to be caught in the next,
   * and for there to be time to say the word again.
   */
  gapMs?: number;
  /** How long the live test listens for. */
  liveTestMs?: number;
}

export interface VoiceTrainerState {
  /** The saved commands, if there are any. */
  profile: VoiceProfile | null;
  /** What the commands are called right now. Labels only. */
  phrases: VoicePhrases;
  /** Samples recorded this time, per command. */
  counts: VoiceCounts;
  /** Room-noise samples recorded this time. */
  noise: number;
  /** Whether the saved commands are in use. */
  enabled: boolean;
  stage: TrainerStage;
  /** True while something slow is happening. */
  busy: boolean;
  /** The class being recorded right now, if any. */
  recording: RecordingTarget | null;
  /** The class that will be recorded next when the recording carries on. */
  upcoming: RecordingTarget | null;
  /** Whether the recording carries on by itself. */
  auto: boolean;
  /** The training progress, while training. */
  progress: { epoch: number; epochs: number } | null;
  /** How the last test went. */
  test: TrainResult | null;
  /** What the live test heard, in the words it should be shown in. */
  heard: string | null;
  /** What went wrong, if anything. */
  error: string | null;
  /** Whether closing now would throw the samples away. */
  unsaved: boolean;
  /** What is wrong with the names, if anything. */
  phraseError: string | null;
}

/** How long the live test listens for. */
const LIVE_TEST_MS = 2_500;

/**
 * The pause between two samples of a recording that carries on by itself.
 *
 * Long enough that the tail of one word is not caught in the next, and that
 * there is time to say the word again.
 */
const RECORD_GAP_MS = 450;

export class VoiceTrainer {
  private state: VoiceTrainerState;
  private listeners = new Set<() => void>();
  private session: SampleCollector | null = null;
  /**
   * The head that has just been trained, before it is saved.
   *
   * It is kept so that the person can hear whether it works before deciding
   * to keep it, and it is thrown away with the samples.
   */
  private trained: ListeningRecognizer | null = null;
  /** How to open a set of samples. */
  private readonly openSession: () => Promise<SampleCollector>;
  /** How to ask for the microphone. */
  private readonly askMicrophone: () => Promise<void>;
  /**
   * How to build the recognizer a Run will listen with.
   *
   * It is built from the saved head rather than from the samples, because the
   * samples are thrown away with the dialog and the recognizer that belongs to
   * them goes with them.
   */
  private readonly buildRecognizer: (head: VoiceHead) => Promise<ListeningRecognizer>;
  /** The pause between two samples of a recording that carries on. */
  private readonly gapMs: number;
  /** How long the live test listens for. */
  private readonly liveTestMs: number;
  /**
   * Bumped to stop a chain of recordings that is running.
   *
   * A recording that has begun cannot be taken back — the library has no way
   * of stopping it half-way — but the ones after it can.
   */
  private chainId = 0;

  constructor({
    openSession,
    askMicrophone,
    buildRecognizer,
    gapMs = RECORD_GAP_MS,
    liveTestMs = LIVE_TEST_MS,
  }: VoiceTrainerOptions = {}) {
    this.openSession =
      openSession ??
      (async () => {
        const { openSampleCollector } = await import("./trainer");
        // The same constraints the Run listens with, so that a sample is
        // recorded the way the app will hear it.
        return await openSampleCollector({ audioTrackConstraints: RAW_MICROPHONE });
      });
    this.askMicrophone = askMicrophone ?? ensureMicrophone;
    this.buildRecognizer =
      buildRecognizer ??
      (async (head) => {
        const { recognizerFromHead } = await import("./trainer");
        return await recognizerFromHead(head);
      });
    this.gapMs = gapMs;
    this.liveTestMs = liveTestMs;
    this.state = {
      profile: null,
      phrases: defaultPhrases(),
      counts: emptyCounts(),
      noise: 0,
      enabled: false,
      stage: "names",
      busy: false,
      recording: null,
      upcoming: null,
      auto: true,
      progress: null,
      test: null,
      heard: null,
      error: null,
      unsaved: false,
      phraseError: null,
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = (): VoiceTrainerState => this.state;

  private set(patch: Partial<VoiceTrainerState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  /** Read the saved commands and get ready to work with them. */
  async load(): Promise<void> {
    try {
      const profile = await getVoiceProfile();
      this.set({
        profile,
        phrases: profile?.phrases ?? this.state.phrases,
        // The counts on the profile are what it was trained on; this time
        // has recorded nothing yet.
        counts: emptyCounts(),
        noise: 0,
        enabled: profile?.enabled ?? false,
        stage: "names",
        error: null,
        phraseError: null,
      });
    } catch (error) {
      this.set({ error: "your saved voice commands could not be read" });
      console.error("Voice commands could not be read", error);
    }
  }

  /** Change the names. These are labels: they do not retrain anything. */
  setPhrases(phrases: VoicePhrases): void {
    this.set({ phrases, phraseError: phraseProblem(phrases) });
  }

  /**
   * Keep the new names.
   *
   * The names are labels, so this does not retrain anything: the head that
   * was trained is the head that keeps being used, and nothing is recorded
   * again. Only the names are written.
   */
  async rename(): Promise<void> {
    const profile = this.state.profile;
    if (!profile) return;
    const problem = phraseProblem(this.state.phrases);
    if (problem) {
      this.set({ phraseError: problem });
      return;
    }
    this.set({ busy: true, error: null });
    try {
      const now = Date.now();
      const updated = await renameVoiceProfile(profile.id, this.state.phrases, now);
      this.set({ profile: updated, busy: false });
    } catch (error) {
      console.error("Voice commands could not be renamed", error);
      this.set({ busy: false, error: "your voice commands could not be renamed — try again" });
    }
  }

  /**
   * Start again from nothing.
   *
   * The samples of a previous training are not kept, so this is the only way
   * to change what the commands sound like: the samples have to be made
   * again.
   */
  async beginTraining(): Promise<void> {
    this.chainId += 1;
    this.set({ busy: true, error: null, test: null, heard: null });
    // The microphone is asked for before the model is fetched, so that a
    // refusal is reported as a refusal rather than hidden behind a
    // download — and so that the permission prompt does not arrive with
    // the first word already being asked for.
    try {
      await this.askMicrophone();
    } catch (error) {
      this.set({
        busy: false,
        error: describeFailure(error, "the microphone could not be opened"),
      });
      return;
    }
    try {
      this.session?.dispose();
      this.session = await this.openSession();
      this.trained = null;
      this.set({
        counts: emptyCounts(),
        noise: 0,
        stage: "record",
        busy: false,
        unsaved: false,
        progress: null,
        recording: null,
        upcoming: null,
      });
    } catch (error) {
      this.set({
        busy: false,
        error: describeFailure(error, "the speech model could not be loaded"),
      });
    }
  }

  /**
   * Record the next sample that is needed.
   *
   * The commands are taken in turn, so the person says each word once before
   * saying it again, rather than one word over and over.
   */
  async recordNext(): Promise<void> {
    const next = nextToRecord(this.state.counts, this.state.noise);
    if (!next) return;
    await this.startRecording(next);
  }

  /**
   * Whether the recording carries on by itself.
   *
   * With it on, one tap records the sample that was asked for and then goes
   * on to the next one, so a person does not have to press the button once
   * for every sample.
   */
  setAuto(auto: boolean): void {
    this.set({ auto });
  }

  /**
   * Stop the recording where it is.
   *
   * What has been recorded so far stays; only the samples that had not begun
   * are dropped.
   */
  stopRecording(): void {
    this.chainId += 1;
    this.set({ busy: false, recording: null, upcoming: null });
  }

  /**
   * Record one sample, and then the ones after it.
   *
   * A tap replaces any chain that was running: two recordings at once would
   * fight over the microphone, and the second one would be refused.
   *
   * The promise is settled once the sample that was asked for has been taken;
   * the samples after it go on in the background, so the person is not kept
   * waiting for a button that has already done its work.
   */
  private async startRecording(target: RecordingTarget): Promise<void> {
    this.chainId += 1;
    const id = this.chainId;
    const recorded = await this.collect(target);
    if (recorded && this.state.auto && id === this.chainId) {
      void this.chain(id, target);
      return;
    }
    if (id === this.chainId) this.set({ busy: false, recording: null, upcoming: null });
  }

  /**
   * Keep recording until everything has been recorded as often as it should.
   *
   * The pause between samples is there so the tail of one word is not caught
   * in the next, and so there is time to breathe.
   */
  private async chain(id: number, from: RecordingTarget): Promise<void> {
    let target = from;
    try {
      for (;;) {
        if (!this.state.auto || id !== this.chainId) return;
        const next = nextToRecord(this.state.counts, this.state.noise, target);
        if (!next) return;
        this.set({ upcoming: next });
        await wait(this.gapMs);
        if (id !== this.chainId) return;
        if (!(await this.collect(next))) return;
        target = next;
      }
    } finally {
      if (id === this.chainId) this.set({ busy: false, recording: null, upcoming: null });
    }
  }

  /**
   * Record one sample of a class.
   *
   * Returns whether the sample was recorded, so a chain of recordings knows
   * when to stop.
   */
  private async collect(label: RecordingTarget): Promise<boolean> {
    const session = this.session;
    if (!session) {
      this.set({ error: "record some samples first", busy: false });
      return false;
    }
    this.set({ busy: true, error: null, recording: label });
    try {
      await session.record(label);
      if (label === NOISE_LABEL) {
        this.set({ recording: null, noise: this.state.noise + 1, unsaved: true });
        return true;
      }
      const counts = { ...this.state.counts };
      counts[label] = (counts[label] ?? 0) + 1;
      this.set({ recording: null, counts, unsaved: true });
      return true;
    } catch (error) {
      this.set({ busy: false, error: describeFailure(error, "the sample could not be recorded") });
      return false;
    }
  }

  /** Take back the last sample of a command, or of the room. */
  undo(key?: VoiceCommandKey): void {
    const session = this.session;
    if (!session) return;
    // A sample cannot be taken back while the recording is still running.
    this.chainId += 1;
    const label = key ?? NOISE_LABEL;
    session.undo(label);
    if (key) {
      const counts = { ...this.state.counts };
      counts[key] = Math.max(0, (counts[key] ?? 0) - 1);
      this.set({ counts });
      return;
    }
    this.set({ noise: Math.max(0, this.state.noise - 1) });
  }

  /** Train the head, then measure it against the samples it was trained on. */
  async train(): Promise<void> {
    const session = this.session;
    if (!session) {
      this.set({ error: "record some samples first" });
      return;
    }
    this.chainId += 1;
    this.set({
      busy: true,
      stage: "train",
      progress: { epoch: 0, epochs: TRAIN_EPOCHS },
      error: null,
      recording: null,
      upcoming: null,
    });
    try {
      // Training reads every sample and builds its tensors without yielding,
      // so the progress step would not reach the screen until the first epoch
      // had finished. Give the browser a frame to paint it first.
      await afterPaint();
      // The dialog may have been closed while that frame went by.
      if (this.session !== session) return;
      await session.train((progress) => this.set({ progress }));
      const test = await session.test();
      // The head is kept so that it can be heard working before it is saved.
      this.trained = session.recognizer();
      this.set({ busy: false, stage: "test", test });
    } catch (error) {
      console.error("Voice commands could not be trained", error);
      this.set({
        busy: false,
        stage: "record",
        progress: null,
        error: "your commands could not be trained — try again with a few more samples",
      });
    }
  }

  /** Keep the trained head and the names. */
  async save(): Promise<void> {
    const session = this.session;
    if (!session) return;
    this.set({ busy: true, error: null });
    try {
      const id = this.state.profile?.id ?? newId();
      const head = await session.head(id);
      const now = Date.now();
      // A person who switched their own commands off meant it: training new
      // ones does not switch them back on behind their back.
      const enabled = this.state.profile?.enabled ?? true;
      const profile: VoiceProfile = {
        id,
        phrases: this.state.phrases,
        counts: { ...this.state.counts },
        noise: this.state.noise,
        enabled,
        createdAt: this.state.profile?.createdAt ?? now,
        updatedAt: now,
        trainedAt: now,
      };
      // The Run listens with a recognizer built from the head that is about to
      // be kept, the same way a reload builds one, rather than with the one
      // that belongs to the samples. The samples are thrown away when the
      // dialog closes, and the library's way of throwing them away also
      // forgets the word labels its recognizer reads — which left a fresh Run
      // deaf until the page was reloaded. Building it here is also a check
      // that the head is usable before anything is written.
      const recognizer = enabled ? await this.buildRecognizer(head) : null;
      await saveVoiceProfile(profile, head);
      if (recognizer) {
        // The head is in use from now on, without waiting for a reload.
        setRecognizer(recognizer);
      } else {
        // The commands are saved but switched off, so the built-in words are
        // still what a Run listens for.
        resetRecognizers();
      }
      this.set({ profile, enabled, stage: "saved", busy: false, unsaved: false });
    } catch (error) {
      console.error("Voice commands could not be saved", error);
      // The head is not put into use: a Run would then listen for commands
      // that are not saved, while the app still said the old names. The
      // samples are kept, so that saving can be tried again.
      this.set({ busy: false, error: describeSaveFailure(error) });
    }
  }

  /** Switch the custom commands on or off. */
  async setEnabled(enabled: boolean): Promise<void> {
    const profile = this.state.profile;
    if (!profile) return;
    this.set({ busy: true, error: null });
    try {
      const head = await getVoiceHead(profile.id);
      if (!head) throw new Error("the head is missing");
      const updated: VoiceProfile = { ...profile, enabled, updatedAt: Date.now() };
      await saveVoiceProfile(updated, head);
      if (!enabled) resetRecognizers();
      this.set({ profile: updated, enabled, busy: false });
    } catch (error) {
      console.error("Voice commands could not be switched", error);
      this.set({ busy: false, error: "your custom commands need to be retrained" });
    }
  }

  /** Forget the custom commands altogether. */
  async remove(): Promise<void> {
    const profile = this.state.profile;
    if (!profile) return;
    this.set({ busy: true, error: null });
    try {
      await deleteVoiceProfile(profile.id);
      resetRecognizers();
      this.set({
        profile: null,
        counts: emptyCounts(),
        noise: 0,
        enabled: false,
        stage: "names",
        busy: false,
        unsaved: false,
        test: null,
        heard: null,
      });
    } catch (error) {
      console.error("Voice commands could not be removed", error);
      this.set({ busy: false, error: "your voice commands could not be removed" });
    }
  }

  /**
   * Listen for a moment and say what was heard.
   *
   * This is the check a person can do without recording anything: say the
   * word and see whether the app hears it. A head that has just been trained
   * is checked with that head, before it is saved, so that it can be heard
   * working before anything is kept.
   *
   * What is shown is what the app heard: the person's own name when the head
   * is theirs, and the English word when the built-in model is listening,
   * because saying "go" deserves to be told that the app heard "go".
   */
  async liveTest(): Promise<void> {
    this.set({ busy: true, error: null, heard: null });
    let recognizer: ListeningRecognizer | null = null;
    let own = false;
    try {
      if (this.trained) {
        recognizer = this.trained;
        own = true;
      } else {
        recognizer = await recognizerForListening();
        own = Boolean(this.state.profile?.enabled);
      }
      const labels = recognizer.wordLabels();
      let heard: string | null = null;
      await recognizer.listen(
        async (result) => {
          const { label, command } = bestLabel(labels, result.scores);
          if (!command) return;
          heard = own ? this.state.phrases[command] : label;
        },
        {
          includeSpectrogram: false,
          probabilityThreshold: COMMAND_CONFIDENCE,
          invokeCallbackOnNoiseAndUnknown: false,
        },
      );
      await wait(this.liveTestMs);
      this.set({ busy: false, heard });
    } catch (error) {
      this.set({
        busy: false,
        error: describeFailure(error, "the microphone could not be opened"),
      });
    } finally {
      await recognizer?.stopListening().catch(() => {});
    }
  }

  /**
   * Throw the samples away.
   *
   * Closing the dialog without keeping anything must not leave a trained head
   * behind in the Run, nor samples in memory.
   */
  discard(): void {
    this.chainId += 1;
    this.session?.dispose();
    this.session = null;
    this.trained = null;
    this.set({
      counts: emptyCounts(),
      noise: 0,
      unsaved: false,
      stage: "names",
      busy: false,
      recording: null,
      upcoming: null,
    });
  }
}

/** Wait a little while. */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait until what was just set has had a chance to reach the screen.
 *
 * Resolving on the next animation frame would still be before that frame is
 * painted, so this waits for two: the first frame paints, and the second is
 * the one the promise settles on. A browser without animation frames — a test
 * — gets the next task instead, which is the same chance to paint.
 */
function afterPaint(): Promise<void> {
  if (typeof requestAnimationFrame !== "function") {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

/**
 * Say what went wrong in a way a person can act on.
 *
 * The microphone is the usual culprit and the browser says why in the
 * exception's name rather than in its message, so that is looked at first.
 */
function describeFailure(error: unknown, fallback: string): string {
  const failure = describeCommandError(error);
  // The generic sentence is only used when the error carried nothing at all.
  if (failure.message !== "the microphone could not be opened") return failure.message;
  return fallback;
}

/** Say what went wrong when the store would not take the head. */
function describeSaveFailure(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "QuotaExceededError") {
    return "this browser has no room left for your voice commands — free some space and try again";
  }
  return "your voice commands could not be saved — try again";
}
