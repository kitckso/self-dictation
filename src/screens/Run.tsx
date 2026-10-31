import { useEffect, useRef, useState } from "react";
import {
  chunkSteps,
  clampDelay,
  clampRepeats,
  MAX_DELAY_SEC,
  MAX_REPEATS,
  MIN_REPEATS,
} from "../domain/autoplay";
import { significantLength } from "../domain/chunking";
import { DEFAULT_RATE, formatRate, MAX_RATE, MIN_RATE, stepRate } from "../domain/rate";
import { languageById, type LanguageId, type Mode } from "../domain/types";
import { isAndroidLike, webSpeech } from "../tts";
import type { CommandListener } from "../voice/CommandListener";
import { describeCommandError, type CommandFailure } from "../voice/errors";
import type { VoicePhrases } from "../voice/profile";

export interface RunState {
  title: string;
  language: LanguageId;
  mode: Mode;
  chunks: string[];
  collectionId: string | null;
  /**
   * When this Run began. Stamped when the Run screen opens rather than when it
   * ends, so the saved record says how long the Passage was actually practised.
   */
  startedAt: number;
}

interface Props {
  run: RunState;
  /** What was typed, one entry per Chunk. Empty strings where nothing was. */
  onFinish: (transcripts: string[]) => void;
  /**
   * Hears the next and repeat words. Absent when there is nothing to listen
   * with, which is also what keeps the microphone out of tests that are about
   * speech alone.
   */
  commands?: CommandListener;
  /**
   * What the person calls the commands, when they have trained their own.
   *
   * These are labels: the model still answers to the built-in English words
   * unless a trained head is in use. The hint tells the truth either way.
   */
  commandPhrases?: VoicePhrases;
  /**
   * Whether the words to name are known.
   *
   * A profile read that failed must not be reported as the built-in words:
   * the recognizer reads the store itself and may still hear the person's own
   * commands, so naming "go" and "no" could be simply wrong.
   */
  commandWords?: "pending" | "known" | "unknown";
  /** Play the first Chunk once as soon as the Run opens. */
  autoStart?: boolean;
}

type AnswerOn = "paper" | "typed";

/** The BCP-47 tag we ask the device for. */
function speakTag(lang: LanguageId): string {
  return languageById(lang).tags[0] ?? "en";
}

/**
 * Typing is a valid answer in Latin script and a misleading one in Chinese,
 * so it is the default only for English. See GLOSSARY.md, "Transcript".
 */
function defaultAnswerOn(lang: LanguageId): AnswerOn {
  return lang === "en" ? "typed" : "paper";
}

/**
 * A beat after the Voice stops before the microphone is reopened.
 *
 * Android takes a moment to move the audio route back from capture to
 * playback. Reopening the microphone inside that window makes the next play
 * start at the wrong volume, and the first word can be lost to the handover.
 * Other platforms do not need the pause.
 */
const ANDROID_LISTEN_SETTLE_MS = 300;

/** What to say when the voice did not finish. */
function failureReason(result: "cut-off" | "failed"): string {
  return result === "cut-off"
    ? "the voice stopped before it finished"
    : "the browser refused to speak";
}

/**
 * Every Chunk visible as a numbered slot so you can see how much is left
 * without seeing a word of it.
 *
 * Nothing about the material appears here — no Reference, no score. Listen,
 * write it down, and the whole Passage is revealed at once on Results.
 */
export function Run({
  run,
  onFinish,
  commands,
  commandPhrases,
  commandWords = "known",
  autoStart = false,
}: Props) {
  const [transcripts, setTranscripts] = useState<Record<number, string>>({});
  const [cursor, setCursor] = useState(0);
  const [speaking, setSpeaking] = useState<number | null>(null);
  /**
   * The live answer for the listener effect. `setSpeaking` schedules a render,
   * so the effect that runs in the same commit as `playOnce` would still see
   * the old `null` and could open the microphone while the Voice is starting.
   */
  const speakingRef = useRef<number | null>(null);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [commandError, setCommandError] = useState<CommandFailure | null>(null);
  /** Bumped when the person asks to try the microphone again. */
  const [commandRetry, setCommandRetry] = useState(0);
  /** True until the model and microphone have actually started listening. */
  const [commandStarting, setCommandStarting] = useState(Boolean(commands));
  /**
   * Bumped every time the device starts or stops talking.
   *
   * The listening effect waits on this rather than on `speaking`, because a
   * play that begins and ends inside one React batch never changes `speaking`
   * as far as the effect can see — and the microphone would then never be
   * opened at all.
   */
  const [speechTurn, setSpeechTurn] = useState(0);
  const [auto, setAuto] = useState(false);
  /** Bumped to restart auto-play from the cursor, even if it was already on. */
  const [autoRun, setAutoRun] = useState(0);
  const [autoOpen, setAutoOpen] = useState(false);
  const [repeats, setRepeats] = useState(2);
  const [delaySec, setDelaySec] = useState(5);
  const [rate, setRate] = useState(DEFAULT_RATE);
  const [answerOn, setAnswerOn] = useState<AnswerOn>(() => defaultAnswerOn(run.language));
  const typingAllowed = answerOn === "typed";
  const listRef = useRef<HTMLDivElement>(null);
  const tag = speakTag(run.language);
  const typedCount = Object.values(transcripts).filter((t) => t.trim()).length;
  /** Anything at all is speaking, so every play control now means stop. */
  const playing = auto || speaking !== null;
  /**
   * The rail's play button is a glyph to save width, so its name has to say
   * what the glyph means — including which Chunk it would speak.
   */
  const playLabel = playing ? "Stop" : `Speak chunk ${cursor + 1}`;

  /**
   * The words the hint names.
   *
   * A person who has trained their own commands hears their own words here;
   * everyone else hears the built-in English ones. The built-in model accepts
   * "go" or "yes" for the next chunk and "no" for a repeat.
   */
  const words = commandPhrases
    ? {
        next: `“${commandPhrases.next}”`,
        repeat: `“${commandPhrases.repeat}”`,
      }
    : { next: "“go” or “yes”", repeat: "“no”" };

  /**
   * Whoever bumps this owns the speaker. A tap, a stop, or the effect being
   * torn down all bump it, and the previous owner notices on its next step and
   * goes quiet — so a stale auto-play loop can never talk over a fresh one.
   */
  const playGen = useRef(0);
  /** Where auto-play should start; read without making the effect depend on the cursor. */
  const cursorRef = useRef(cursor);
  /**
   * What the voice-command handler reads.
   *
   * Listening is torn down only while the speaker is busy, so the handler it
   * was given can be a render or two old by the time a command arrives. These
   * refs are the live answer.
   */
  const transcriptsRef = useRef(transcripts);
  const playingRef = useRef(playing);
  /**
   * The settings auto-play reads, deliberately held in a ref rather than named
   * as dependencies of the loop.
   *
   * A play already under way cannot be retuned, and tearing the loop down to
   * pick up a new setting would start the Chunk over. So the repeat count and
   * the pause are read once per Chunk and the Speed once per play: whatever is
   * being heard finishes as it began.
   */
  const settings = useRef({ rate, repeats, delaySec });

  useEffect(
    () => () => {
      webSpeech.cancel();
    },
    [],
  );

  /**
   * Start the Run with one play, not with auto-play.
   *
   * Opening a Run should put something in the ear straight away, then wait:
   * auto-play stays a separate choice, and "go" plays one more Chunk.
   */
  useEffect(() => {
    if (!autoStart) return;
    void playOnce(0);
  }, [autoStart]);

  useEffect(() => {
    settings.current = { rate, repeats, delaySec };
  }, [rate, repeats, delaySec]);

  useEffect(() => {
    cursorRef.current = cursor;
  }, [cursor]);

  useEffect(() => {
    transcriptsRef.current = transcripts;
  }, [transcripts]);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  /**
   * Listen for the next and repeat words whenever the device is quiet.
   *
   * The microphone is let go while the voice speaks: on a phone's speaker the
   * app would otherwise hear its own dictation and steer itself.
   */
  useEffect(() => {
    // `speaking` is the render's value; `speakingRef` is the synchronous one,
    // so a listener cannot start in the same commit that begins a play.
    if (!commands || speakingRef.current !== null) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const start = () => {
      if (!active) return;
      void commands
        .start((command) => {
          if (!active) return;
          if (command === "next") {
            // Saying "next" where there is no next Chunk is how a Run ends.
            if (cursorRef.current >= run.chunks.length - 1) finish();
            else nextAndPlay();
          } else {
            repeatCurrent();
          }
        })
        .then(() => {
          if (!active) return;
          setCommandStarting(false);
          setCommandError(null);
        })
        .catch((error: unknown) => {
          console.error("Voice commands could not start", error);
          if (!active) return;
          setCommandStarting(false);
          setCommandError(describeCommandError(error));
        });
    };

    setCommandStarting(true);
    if (isAndroidLike()) {
      timer = setTimeout(start, ANDROID_LISTEN_SETTLE_MS);
    } else {
      start();
    }

    return () => {
      active = false;
      if (timer !== undefined) clearTimeout(timer);
      void commands.stop();
    };
  }, [commands, speechTurn, commandRetry]);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-slot="${cursor}"]`);
    el?.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
  }, [cursor]);

  useEffect(() => {
    if (!auto) return;
    const gen = ++playGen.current;
    const mine = () => gen === playGen.current;
    const chunks = run.chunks;
    void (async () => {
      // Planned one Chunk at a time, so repeats and pause are read when the
      // next Chunk starts rather than by restarting the one already speaking.
      // Speed is not part of the plan: it is read per play, just below.
      let firstPlay = true;
      for (let index = cursorRef.current; index < chunks.length; index++) {
        const { repeats: times, delaySec: pause } = settings.current;
        for (const step of chunkSteps(index, times, pause * 1000, firstPlay)) {
          if (!mine()) return;
          if (step.waitMs > 0) {
            await sleep(step.waitMs);
            if (!mine()) return;
          }
          firstPlay = false;
          setCursor(step.index);
          beginSpeech(step.index);
          // Let the microphone go before the speaker starts, rather than
          // waiting for the effect that follows this render.
          if (commands) await releaseMicrophone();
          if (!mine()) return;
          const heard = await webSpeech.speak(chunks[step.index] ?? "", {
            lang: tag,
            rate: settings.current.rate,
            onError: (reason) => {
              if (mine()) setSpeechError(reason);
            },
          });
          if (!mine()) return;
          // A voice that never spoke, or stopped half-way, is not progress.
          // Carrying on would walk the cursor to the end in silence.
          if (heard !== "finished") {
            setSpeechError((prev) => prev ?? failureReason(heard));
            endSpeech();
            setAuto(false);
            return;
          }
          // The speaker is quiet again during the pause that follows, so the
          // microphone can listen for "stop" between plays.
          endSpeech();
        }
      }
      if (!mine()) return;
      endSpeech();
      setAuto(false);
    })();

    return () => {
      playGen.current += 1;
    };
  }, [auto, autoRun, run.chunks, tag]);

  /** Take the speaker, synchronously, so no listener starts behind it. */
  function beginSpeech(index: number) {
    speakingRef.current = index;
    setSpeaking(index);
    setSpeechTurn((turn) => turn + 1);
    setSpeechError(null);
  }

  /** Give the speaker back and let the listening effect take over. */
  function endSpeech() {
    speakingRef.current = null;
    setSpeaking(null);
    setSpeechTurn((turn) => turn + 1);
  }

  /**
   * Wait for the microphone to let go of the audio route.
   *
   * A custom listener may fail to stop; that is not a reason to swallow the
   * play. The adapter itself already resolves on a failed stop.
   */
  async function releaseMicrophone(): Promise<void> {
    try {
      await commands?.stop();
    } catch (error) {
      console.error("Voice commands could not release the microphone", error);
    }
  }

  /** Silence whoever is speaking and forget them. */
  function stopPlayback() {
    playGen.current += 1;
    webSpeech.cancel();
    setAuto(false);
    endSpeech();
  }

  function toggleAuto() {
    if (auto) stopPlayback();
    else setAuto(true);
  }

  /** Moving the cursor deliberately ends auto-play rather than fighting it. */
  function focusSlot(i: number) {
    if (auto) stopPlayback();
    setCursor(i);
  }

  /** Say one Chunk once, without touching auto-play. */
  async function playOnce(i: number) {
    const gen = ++playGen.current;
    beginSpeech(i);
    // Silence the microphone before the voice speaks; the listener must not
    // hear the app's own dictation. Wait for the release: on Android the
    // speaker is on the other side of the same audio route.
    if (commands) await releaseMicrophone();
    if (gen !== playGen.current) return;
    try {
      const heard = await webSpeech.speak(run.chunks[i] ?? "", {
        lang: tag,
        rate: settings.current.rate,
        onError: (reason) => setSpeechError(reason),
      });
      if (gen === playGen.current && heard !== "finished") {
        // A reason from onError is more specific than the general one.
        setSpeechError((prev) => prev ?? failureReason(heard));
      }
    } finally {
      if (gen === playGen.current) endSpeech();
    }
  }

  async function speak(i: number) {
    // While something is already playing, the button reads "stop" — so stop.
    if (playing) {
      stopPlayback();
      return;
    }
    await playOnce(i);
  }

  function next() {
    stopPlayback();
    setCursor((c) => Math.min(c + 1, run.chunks.length - 1));
  }
  /**
   * The voice's next word: move on and say the next Chunk once.
   *
   * This deliberately does not reuse `next()`, which is the rail's quiet
   * "move the cursor" action, and it does not switch auto-play on. If
   * auto-play is already running, it stays on and restarts from the next
   * Chunk; otherwise the next Chunk is played once and the Run waits again.
   *
   * On the last Chunk there is nowhere to move on to, so the handler finishes
   * the Run instead of calling this.
   */
  function nextAndPlay() {
    const nextIndex = Math.min(cursorRef.current + 1, run.chunks.length - 1);
    if (nextIndex === cursorRef.current) return;
    // The microphone only listens in silence, so "playing" here means the
    // person had auto-play on before saying their next word.
    const continueAuto = playingRef.current;
    stopPlayback();
    // Set the ref too: the new play reads it as soon as it starts.
    cursorRef.current = nextIndex;
    setCursor(nextIndex);
    if (continueAuto) {
      setAuto(true);
      setAutoRun((n) => n + 1);
    } else {
      void playOnce(nextIndex);
    }
  }
  /**
   * The voice's repeat word: say the current Chunk again.
   *
   * One-shot like the next word. With auto-play off, play it once and wait. If
   * auto-play is already on, replay from this Chunk and keep going.
   */
  function repeatCurrent() {
    // The microphone only listens in silence, so "playing" here means the
    // person had auto-play on before saying their repeat word.
    const continueAuto = playingRef.current;
    stopPlayback();
    if (continueAuto) {
      setAuto(true);
      setAutoRun((n) => n + 1);
    } else {
      void playOnce(cursorRef.current);
    }
  }
  function back() {
    stopPlayback();
    setCursor((c) => Math.max(c - 1, 0));
  }

  /** End the Run and reveal the whole Passage, whether or not all of it was answered. */
  function finish() {
    stopPlayback();
    const answers = transcriptsRef.current;
    onFinish(run.chunks.map((_, i) => answers[i] ?? ""));
  }

  return (
    <>
      <div className="run-scroll" ref={listRef}>
        <div className="run-head">
          <span className="nm">{run.title}</span>
          <span className="note">
            {cursor + 1}/{run.chunks.length}
            {typingAllowed && typedCount > 0 && ` · ${typedCount} typed`}
          </span>
        </div>

        {speechError && (
          <p className="note bad">
            Speech failed ({speechError}). Your device may not have a {tag} voice installed — write
            the Passage from what you can hear, or go back and add the language in system settings.
          </p>
        )}

        {commands && (
          <p className={commandError ? "note bad" : "note"}>
            {commandError ? (
              <>
                Voice commands are unavailable ({commandError.message}). The buttons still work.{" "}
                {commandError.retryable && (
                  <button
                    className="mini"
                    onClick={() => {
                      setCommandError(null);
                      setCommandRetry((n) => n + 1);
                    }}
                  >
                    Try again
                  </button>
                )}
              </>
            ) : speaking !== null ? (
              "Voice commands are paused while the Voice speaks."
            ) : commandStarting ? (
              "Starting voice commands…"
            ) : commandWords === "pending" ? (
              "Voice commands are on. Reading the words from this browser…"
            ) : commandWords === "unknown" ? (
              // The recognizer reads the store itself and may have the
              // person's own commands, so naming the built-in words here
              // could be a lie about what is actually being listened for.
              "Voice commands are on, but the words could not be read from this browser."
            ) : (
              `Voice commands: say ${words.next} to play the next chunk, ${words.repeat} to hear this one again. On the last chunk, ${words.next} ends the Run.`
            )}
          </p>
        )}

        <div className="answer-on">
          <div className="seg">
            <button aria-pressed={answerOn === "paper"} onClick={() => setAnswerOn("paper")}>
              On paper
            </button>
            <button aria-pressed={answerOn === "typed"} onClick={() => setAnswerOn("typed")}>
              Type it
            </button>
          </div>
        </div>

        {run.chunks.map((chunk, i) => (
          <article
            className={`slot${i === cursor ? " now" : ""}`}
            data-slot={i}
            key={i}
            // A pointer shortcut for moving the cursor. It is deliberately not
            // focusable: the rail's up/down buttons already do this by keyboard,
            // and one tab stop per Chunk would bury the controls that matter.
            onClick={() => focusSlot(i)}
          >
            <header>
              <span className="num">{i + 1}</span>
              <span className="chip">{significantLength(chunk)} chars</span>
              <div className="spacer" />
              <button
                className="mini"
                disabled={auto}
                onClick={(e) => {
                  e.stopPropagation();
                  void speak(i);
                }}
              >
                {speaking === i ? "■ stop" : "▶ speak"}
              </button>
            </header>

            <div className="slot-body">
              {typingAllowed ? (
                <textarea
                  className="answer"
                  rows={1}
                  // Without this a screen reader hears N identical fields and
                  // no way to tell which Chunk is which.
                  aria-label={`Answer for chunk ${i + 1}`}
                  placeholder="type what you hear"
                  value={transcripts[i] ?? ""}
                  onChange={(e) => setTranscripts((prev) => ({ ...prev, [i]: e.target.value }))}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <p className="note paper">write it on paper</p>
              )}
            </div>
          </article>
        ))}
      </div>

      <div className="run-foot">
        {autoOpen && (
          <div className="auto-panel">
            <div className="auto-line">
              <span>each chunk</span>
              <button
                className="step"
                aria-label="Fewer repeats"
                disabled={repeats <= MIN_REPEATS}
                onClick={() => setRepeats((n) => clampRepeats(n - 1))}
              >
                −
              </button>
              <b>{repeats}</b>
              <button
                className="step"
                aria-label="More repeats"
                disabled={repeats >= MAX_REPEATS}
                onClick={() => setRepeats((n) => clampRepeats(n + 1))}
              >
                +
              </button>
              <span>times</span>
            </div>
            <div className="auto-line">
              <span>pause</span>
              <button
                className="step"
                aria-label="Shorter pause"
                disabled={delaySec <= 0}
                onClick={() => setDelaySec((n) => clampDelay(n - 1))}
              >
                −
              </button>
              <b>{delaySec}s</b>
              <button
                className="step"
                aria-label="Longer pause"
                disabled={delaySec >= MAX_DELAY_SEC}
                onClick={() => setDelaySec((n) => clampDelay(n + 1))}
              >
                +
              </button>
              <span>before each play</span>
            </div>
            <div className="auto-line">
              <span>speed</span>
              <button
                className="step"
                aria-label="Slower"
                disabled={rate <= MIN_RATE}
                onClick={() => setRate((r) => stepRate(r, -1))}
              >
                −
              </button>
              <b>{formatRate(rate)}</b>
              <button
                className="step"
                aria-label="Faster"
                disabled={rate >= MAX_RATE}
                onClick={() => setRate((r) => stepRate(r, 1))}
              >
                +
              </button>
              <span>for every play</span>
            </div>
          </div>
        )}

        <div className="run-rail">
          <button
            className="k"
            aria-label={playLabel}
            title={playLabel}
            onClick={() => void speak(cursor)}
          >
            {playing ? "■" : "▶"}
          </button>
          <button
            className="rail-btn"
            aria-label="Previous chunk"
            title="Previous chunk"
            onClick={back}
            disabled={cursor === 0}
          >
            ↑
          </button>
          <button
            className="rail-btn"
            aria-label="Next chunk"
            title="Next chunk"
            onClick={next}
            disabled={cursor === run.chunks.length - 1}
          >
            ↓
          </button>
          <button
            className={`rail-btn${auto ? " on" : ""}`}
            aria-pressed={auto}
            onClick={toggleAuto}
            title={auto ? "Stop auto-play" : `Play from chunk ${cursor + 1} to the end`}
          >
            auto
          </button>
          <button
            className={`rail-btn${autoOpen ? " on" : ""}`}
            aria-expanded={autoOpen}
            onClick={() => setAutoOpen((open) => !open)}
            title="Repeats, pause and speed"
          >
            {repeats}× · {delaySec}s{rate !== DEFAULT_RATE && ` · ${formatRate(rate)}`}
          </button>
          <button
            className="rail-btn go"
            title="End the Run and reveal the Passage"
            onClick={finish}
          >
            end
          </button>
        </div>
      </div>
    </>
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Someone who has asked for less motion should not be scrolled smoothly. */
function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}
