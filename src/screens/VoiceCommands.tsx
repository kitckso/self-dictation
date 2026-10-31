import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type JSX,
  type MouseEvent,
} from "react";
import {
  COMMAND_KEYS,
  nextToRecord,
  NOISE_LABEL,
  readyToTrain,
  RECOMMENDED_NOISE_SAMPLES,
  RECOMMENDED_SAMPLES,
  totalSamples,
  TRAIN_EPOCHS,
  type RecordingTarget,
  type VoiceCommandKey,
} from "../voice/profile";
import type { VoiceTrainer } from "../voice/VoiceTrainer";

/**
 * What each command does, in words a person can act on.
 *
 * The names are only labels, so the field has to say what it is for: somebody
 * who has never seen the app cannot know that "repeat" means "play this chunk
 * again" rather than "repeat the whole passage".
 */
const COMMAND_INFO: Record<VoiceCommandKey, { name: string; does: string }> = {
  next: { name: "Next", does: "plays the next chunk, and ends the run on the last one" },
  repeat: { name: "Repeat", does: "says this chunk again" },
};

export interface VoiceCommandsProps {
  /**
   * The seam this dialog shows.
   *
   * It is made by the caller and handed over, so that the code behind it is
   * only fetched when somebody actually opens this.
   */
  trainer: VoiceTrainer;
  /** Close the dialog. */
  onClose: () => void;
  /** The saved commands changed, so the app can update what a Run says. */
  onChanged?: () => void;
}

/**
 * Teaching the app the words a person actually uses.
 *
 * A dialog, because the microphone has to be asked for and the samples have
 * to be recorded one at a time: this wants the whole screen, and the person
 * has to be able to see what is being asked of them while they say it.
 *
 * Everything about the training is behind `VoiceTrainer`. This screen only
 * shows what is going on and asks for the next thing.
 */
export function VoiceCommands({ trainer, onClose, onChanged }: VoiceCommandsProps): JSX.Element {
  const state = useSyncExternalStore(trainer.subscribe, trainer.getState);
  const dialog = useRef<HTMLDialogElement>(null);
  const removeButton = useRef<HTMLButtonElement>(null);
  /**
   * The closing question.
   *
   * It takes the focus while it is up: the rest of the dialog is not live
   * then, and a focus left behind in a part that cannot be used is a focus
   * nowhere at all.
   */
  const question = useRef<HTMLDivElement>(null);

  /** The remove button needs a second tap before it takes anything away. */
  const [removing, setRemoving] = useState(false);
  /** Whether closing has been agreed to. */
  const [closing, setClosing] = useState(false);
  /**
   * Whether the names are being saved right now.
   *
   * This is not the trainer's `busy`: that is also true while a recording
   * chain is running, and the closing question has to stay usable then.
   */
  const [saving, setSaving] = useState(false);
  /**
   * Whether a save is already under way.
   *
   * A ref, not the state above, because a second tap has to be turned away
   * before the state has been painted — two taps are one event each, and the
   * state cannot answer the second one in time.
   */
  const savingRef = useRef(false);
  /**
   * Why the names were not saved, when the save in the closing question
   * failed.
   *
   * It is kept here rather than read from the trainer's error, so that the
   * question can say what happened in it — and so that the same message is
   * not shown twice, once at the top of the dialog and once in the question.
   */
  const [closingError, setClosingError] = useState<string | null>(null);
  /**
   * Whether the live test has been run.
   *
   * The seam cannot tell "it heard nothing" from "nothing has been tried",
   * because both leave the heard word empty, so the dialog keeps the fact
   * itself.
   */
  const [tested, setTested] = useState(false);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    // showModal brings focus containment, Esc and an inert background with it.
    // A browser without it gets a plain panel rather than an exception.
    if (typeof el.showModal === "function") el.showModal();
    else el.setAttribute("open", "");
  }, []);

  useEffect(() => {
    void trainer.load();
  }, [trainer]);

  useEffect(() => {
    // Nothing of a recording may be left in memory once the dialog is gone.
    return () => trainer.discard();
  }, [trainer]);

  useEffect(() => {
    if (closing) question.current?.focus();
  }, [closing]);

  const profile = state.profile;
  /** Whether there is enough recorded to train a head. */
  const ready = readyToTrain(state.counts, state.noise);
  /** How many samples the saved commands were trained from, the room included. */
  const sampleTotal = profile ? totalSamples(profile.counts, profile.noise ?? 0) : 0;
  /**
   * Whether the names on the screen are not the ones that are saved.
   *
   * The names are labels, so they can be changed on their own: there is no
   * need to record anything again to change them.
   */
  const namesChanged =
    profile !== null &&
    COMMAND_KEYS.some((key) => state.phrases[key].trim() !== profile.phrases[key].trim());
  /**
   * What is worth a question before the dialog goes.
   *
   * Samples that were never trained are the obvious case, but a name that was
   * typed and never saved is just as easy to lose: the person edits it, goes
   * off to record something else, and closes the dialog.
   */
  const closingNote = namesChanged
    ? state.unsaved
      ? "You have samples that have not been trained yet, and names that have not been saved."
      : "You have names that have not been saved yet."
    : "You have samples that have not been trained yet.";
  /** Whether everything has been recorded as often as it should be. */
  const allDone = nextToRecord(state.counts, state.noise) === null;
  const progress = state.progress;
  /** How far through the training the head is, as a percentage of the bar. */
  const percent =
    progress && progress.epochs > 0 ? Math.round((progress.epoch / progress.epochs) * 100) : 0;

  function changePhrase(key: VoiceCommandKey, value: string) {
    trainer.setPhrases({ ...state.phrases, [key]: value });
  }

  /**
   * What to call a class in words.
   *
   * The person's own word is what they will hear themselves say, so it is the
   * one worth showing; the room has no word of its own.
   */
  function targetName(target: RecordingTarget | null): string {
    if (!target) return "";
    if (target === NOISE_LABEL) return "the room";
    return `“${state.phrases[target]}”`;
  }

  function closeNow() {
    // The recordings go with the dialog: nothing of them may be left behind.
    trainer.discard();
    onClose();
  }

  function requestClose() {
    // Samples that were never trained, and names that were never saved, are
    // both worth a question before they go.
    if (state.unsaved || namesChanged) {
      setClosing(true);
      return;
    }
    closeNow();
  }

  /** Give up on closing, and go back to what was being done. */
  function cancelClose() {
    setClosing(false);
    // The reason the last attempt failed is about that attempt: it is said
    // again if it happens again, rather than being left on the screen.
    setClosingError(null);
  }

  async function liveTest() {
    await trainer.liveTest();
    setTested(true);
  }

  async function setEnabled(enabled: boolean) {
    await trainer.setEnabled(enabled);
    onChanged?.();
  }

  async function save() {
    await trainer.save();
    onChanged?.();
  }

  async function rename() {
    await trainer.rename();
    onChanged?.();
  }

  /**
   * Keep the names and close.
   *
   * The names are the only thing that is asked about here, so this is the
   * one chance to keep them: the samples that were recorded are thrown away
   * with the dialog, but the names can still be saved on their own.
   */
  async function saveNamesAndClose() {
    // A second tap must not start a second write: the first one is still
    // going, and the dialog may already be closing under it.
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setClosingError(null);
    try {
      await trainer.rename();
      onChanged?.();
      const saved = trainer.getState().profile;
      const phrases = trainer.getState().phrases;
      const kept =
        saved !== null &&
        COMMAND_KEYS.every((key) => phrases[key].trim() === saved.phrases[key].trim());
      // The rename may have failed: the question stays open, with the reason
      // in it, so that the names can be tried again. The wording is the
      // trainer's own, so it is said the same way wherever it appears.
      if (!kept) {
        setClosingError(
          trainer.getState().error ?? "your voice commands could not be renamed — try again",
        );
        return;
      }
      closeNow();
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function remove() {
    await trainer.remove();
    onChanged?.();
  }

  function clickRemove() {
    // Two taps: the first only asks, the second takes the commands away.
    if (!removing) {
      setRemoving(true);
      return;
    }
    void remove();
  }

  /**
   * Any other interaction puts the remove button back.
   *
   * A button that has changed its own label is a trap if it stays that way
   * forever, so anything else the person does takes the question back.
   */
  function resetRemove(event: MouseEvent<HTMLElement>) {
    const button = removeButton.current;
    if (button && event.target instanceof Node && button.contains(event.target)) return;
    setRemoving(false);
  }

  return (
    <dialog
      className="voice"
      aria-labelledby="voice-commands-title"
      ref={dialog}
      onCancel={(event) => {
        // The dialog is closed by this component rather than by the browser:
        // there may be recordings to ask about first.
        event.preventDefault();
        requestClose();
      }}
    >
      <div className="voice-scroll">
        <h2 className="voice-title" id="voice-commands-title">
          Voice commands
        </h2>

        <p className="voice-sub">
          {profile
            ? "Your own words for next and repeat."
            : "Everything happens on this device. The samples are used to train your commands and are thrown away afterwards — they are never kept, and nothing is sent anywhere."}
        </p>

        {/*
            The rest of the dialog is not live while the question is up.
            The question is what is being answered, and nothing behind it
            should be able to start a recording or take the commands away.
            The errors are said in the question instead, so that they are
            said once, and where the person is looking.
        */}
        <div className="voice-body" inert={closing ? true : undefined}>
          {state.error && !closing && <p className="note bad">{state.error}</p>}

          {state.busy && state.stage === "names" && (
            <p className="note voice-working">
              <i className="spin" aria-hidden="true" />
              Working — this can take a few seconds.
            </p>
          )}

          {state.stage === "names" && !profile && (
            <div className="voice-step">
              <p>
                The app can learn your own words for the two things a dictation can be told to do.
                You say each of them a few times, it learns to tell them apart, and from then on it
                listens for your words instead of the built-in English ones.
              </p>
            </div>
          )}

          {state.stage === "names" && (
            <div className="voice-step">
              <h3 className="lbl">What to call them</h3>
              {COMMAND_KEYS.map((key) => (
                <div className="voice-field" key={key}>
                  <span>
                    <label htmlFor={`voice-name-${key}`}>
                      {COMMAND_INFO[key].name} — {COMMAND_INFO[key].does}
                    </label>
                  </span>
                  <input
                    className="box"
                    id={`voice-name-${key}`}
                    value={state.phrases[key]}
                    onChange={(event) => changePhrase(key, event.currentTarget.value)}
                    disabled={state.busy}
                  />
                </div>
              ))}
              {/* The closing question says the reason too, so it is said once
                  and where the person is looking. */}
              {state.phraseError && !closing && <p className="note bad">{state.phraseError}</p>}
              <p className="note">The built-in words are “go” or “yes”, and “no”.</p>
              {profile && (
                <p className="note">
                  The names are only labels: the app still listens for the same two things, and it
                  keeps working whichever names you give them. Saying something different means
                  recording it again.
                </p>
              )}
              {profile && namesChanged && !closing && (
                <div className="voice-actions">
                  <button
                    className="btn primary"
                    disabled={state.busy || state.phraseError !== null}
                    onClick={() => void rename()}
                  >
                    Save the names
                  </button>
                </div>
              )}
            </div>
          )}

          {state.stage === "names" && !profile && (
            <div className="voice-step">
              <p className="note">The app will ask for the microphone when you start.</p>
              <div className="voice-actions">
                <button
                  className="btn primary"
                  disabled={state.busy}
                  onClick={() => void trainer.beginTraining()}
                >
                  Start recording
                </button>
              </div>
            </div>
          )}

          {state.stage === "record" && (
            <div className="voice-step">
              <h3 className="lbl">Record samples</h3>
              <p className="note">
                Say each word on its own, in your own voice. The recording goes on until it has{" "}
                {RECOMMENDED_SAMPLES} samples of each command and {RECOMMENDED_NOISE_SAMPLES} of the
                room's noise. The samples are not kept — they are thrown away as soon as your
                commands have been trained.
              </p>
              {profile && (
                <p className="note">
                  The commands you have now stay in use until the new ones are trained and saved.
                </p>
              )}
              <label className="voice-check">
                <input
                  type="checkbox"
                  checked={state.auto}
                  onChange={(event) => trainer.setAuto(event.currentTarget.checked)}
                />
                <span>Keep recording the next sample by itself</span>
              </label>

              {state.busy && (
                <div className="voice-rec">
                  <p className="note voice-working">
                    <i className="spin" aria-hidden="true" />
                    {state.recording
                      ? `Recording ${targetName(state.recording)}…`
                      : `Next: ${targetName(state.upcoming)}`}
                  </p>
                </div>
              )}

              {COMMAND_KEYS.map((key) => (
                <div className="voice-row" key={key}>
                  <span className="nm">
                    {state.recording === key && <i className="rec-dot" aria-hidden="true" />}
                    {COMMAND_INFO[key].name} — “{state.phrases[key]}”
                  </span>
                  <span className="voice-count">
                    {state.counts[key]} of {RECOMMENDED_SAMPLES} samples
                  </span>
                  <button
                    className="rowbtn voice-undo"
                    aria-label={`Undo one ${COMMAND_INFO[key].name.toLowerCase()} sample`}
                    disabled={state.busy || (state.counts[key] ?? 0) === 0}
                    onClick={() => trainer.undo(key)}
                  >
                    ×
                  </button>
                </div>
              ))}
              <div className="voice-row">
                <span className="nm">
                  {state.recording === NOISE_LABEL && <i className="rec-dot" aria-hidden="true" />}
                  Room noise
                </span>
                <span className="voice-count">
                  {state.noise} of {RECOMMENDED_NOISE_SAMPLES} samples
                </span>
                <button
                  className="rowbtn voice-undo"
                  aria-label="Undo one room noise sample"
                  disabled={state.busy || state.noise === 0}
                  onClick={() => trainer.undo()}
                >
                  ×
                </button>
              </div>

              <div className="voice-actions">
                {state.busy ? (
                  <button className="btn" onClick={() => trainer.stopRecording()}>
                    Stop recording
                  </button>
                ) : (
                  <button
                    className="btn primary"
                    disabled={allDone}
                    onClick={() => void trainer.recordNext()}
                  >
                    Start recording
                  </button>
                )}
              </div>

              {ready && (
                <p className="note">Enough to train now. Recording more makes it steadier.</p>
              )}

              <div className="voice-actions">
                <button
                  className="btn primary"
                  disabled={state.busy || !ready}
                  onClick={() => void trainer.train()}
                >
                  Train
                </button>
              </div>
            </div>
          )}

          {state.stage === "train" && (
            <div className="voice-step">
              <p className="note voice-working">
                <i className="spin" aria-hidden="true" />
                {progress && progress.epoch > 0
                  ? "Training your commands…"
                  : "Getting the speech model ready — this can take a few seconds…"}
              </p>
              <div className="voice-progress">
                <i style={{ width: `${percent}%` }} />
              </div>
              <p className="note">
                Epoch {progress?.epoch ?? 0} of {progress?.epochs ?? TRAIN_EPOCHS}
              </p>
            </div>
          )}

          {state.stage === "test" && (
            <div className="voice-step">
              {state.test ? (
                <p className="note good">
                  It heard {state.test.correct} of your {state.test.total} samples correctly.
                </p>
              ) : (
                <p className="note">Your commands have been trained.</p>
              )}
              <div className="voice-actions">
                <button className="btn" disabled={state.busy} onClick={() => void liveTest()}>
                  Try it out
                </button>
              </div>
              {state.heard && <p className="note good">It heard “{state.heard}”.</p>}
              {tested && !state.heard && !state.error && <p className="note">It heard nothing.</p>}
              <div className="voice-actions">
                <button className="btn primary" disabled={state.busy} onClick={() => void save()}>
                  Save
                </button>
              </div>
            </div>
          )}

          {state.stage === "saved" && (
            <div className="voice-step">
              <p className={state.enabled ? "note good" : "note"}>
                {state.enabled
                  ? `Your commands are in use. A dictation will now listen for “${state.phrases.next}” and “${state.phrases.repeat}”. Saying “${state.phrases.next}” on the last chunk ends the run.`
                  : "Your commands are saved, but they are switched off — a dictation listens for the built-in words until you turn them on."}
              </p>
              {!state.enabled && (
                <label className="voice-check">
                  <input
                    type="checkbox"
                    checked={state.enabled}
                    disabled={state.busy}
                    onChange={(event) => void setEnabled(event.currentTarget.checked)}
                  />
                  <span>Use my words instead of the built-in ones</span>
                </label>
              )}
            </div>
          )}

          {state.stage === "names" && profile && (
            <div className="voice-step" onClickCapture={resetRemove}>
              <p className="note">
                Trained on {new Date(profile.trainedAt).toLocaleDateString()} from {sampleTotal}{" "}
                samples.
              </p>
              {state.heard && <p className="note good">It heard “{state.heard}”.</p>}
              {tested && !state.heard && !state.error && <p className="note">It heard nothing.</p>}

              <label className="voice-check">
                <input
                  type="checkbox"
                  checked={state.enabled}
                  disabled={state.busy}
                  onChange={(event) => void setEnabled(event.currentTarget.checked)}
                />
                <span>Use my words instead of the built-in ones</span>
              </label>

              <div className="voice-actions">
                <button className="btn" disabled={state.busy} onClick={() => void liveTest()}>
                  Try them
                </button>
                <button
                  className="btn"
                  disabled={state.busy || state.phraseError !== null}
                  onClick={() => void trainer.beginTraining()}
                >
                  Record new ones
                </button>
              </div>
              <p className="note">
                Recording new ones replaces these, and the ones you have now keep working until the
                new ones are trained. Deleting them puts the built-in words back.
              </p>
              <div className="voice-actions">
                <button
                  className="btn"
                  ref={removeButton}
                  disabled={state.busy}
                  onClick={clickRemove}
                >
                  {removing ? "Really delete them?" : "Delete these commands"}
                </button>
              </div>
            </div>
          )}
        </div>
        {closing ? (
          <div className="voice-step">
            <div className="voice-confirm" ref={question} tabIndex={-1}>
              <p>{closingNote}</p>
              {closingError && <p className="note bad">{closingError}</p>}
              {/* Anything else that went wrong is said here as well: the rest
                  of the dialog is not live while the question is up, so the
                  reason at the top of it would not be read. */}
              {state.error && state.error !== closingError && (
                <p className="note bad">{state.error}</p>
              )}
              {/* The names may be wrong, which stops them being saved. */}
              {state.phraseError && <p className="note bad">{state.phraseError}</p>}
            </div>
            <div className="voice-actions">
              <button className="btn" disabled={saving} onClick={cancelClose}>
                Cancel
              </button>
              <button
                className={namesChanged ? "btn" : "btn primary"}
                disabled={saving}
                onClick={closeNow}
              >
                Close anyway
              </button>
              {namesChanged && (
                <button
                  className="btn primary"
                  disabled={saving || state.phraseError !== null}
                  onClick={() => void saveNamesAndClose()}
                >
                  Save the names
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="voice-step voice-actions">
            {state.stage === "saved" ? (
              <button className="btn primary" onClick={requestClose}>
                Done
              </button>
            ) : (
              <button className="btn" onClick={requestClose}>
                Close
              </button>
            )}
          </div>
        )}
      </div>
    </dialog>
  );
}
