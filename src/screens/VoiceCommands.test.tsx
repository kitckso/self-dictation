// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { VoiceProfile } from "../voice/profile";
import type { VoiceTrainer, VoiceTrainerState } from "../voice/VoiceTrainer";
import { VoiceCommands } from "./VoiceCommands";

/**
 * A stand-in for the trainer.
 *
 * The real one pulls in TensorFlow and a microphone, so the dialog is tested
 * against a state the test controls and a set of calls it can look at.
 */
const h = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const box: { state: VoiceTrainerState | null } = { state: null };
  const trainer = {
    load: vi.fn(async () => {}),
    subscribe: vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
    getState: vi.fn(() => box.state),
    setPhrases: vi.fn(),
    rename: vi.fn(),
    beginTraining: vi.fn(),
    record: vi.fn(),
    recordNext: vi.fn(),
    recordNoise: vi.fn(),
    setAuto: vi.fn(),
    stopRecording: vi.fn(),
    undo: vi.fn(),
    train: vi.fn(),
    save: vi.fn(),
    setEnabled: vi.fn(),
    remove: vi.fn(),
    liveTest: vi.fn(),
    discard: vi.fn(),
  };
  return {
    trainer,
    box,
    /** Put a new state in front of the dialog, as the trainer would. */
    set(state: VoiceTrainerState) {
      box.state = state;
      // A copy, so a listener that unsubscribes while it is told does not
      // disturb the ones still to be called.
      for (const listener of Array.from(listeners)) listener();
    },
    reset() {
      listeners.clear();
      box.state = null;
    },
  };
});

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  h.reset();
});

/** A state with nothing in it, as the dialog first sees it. */
function baseState(over: Partial<VoiceTrainerState> = {}): VoiceTrainerState {
  return {
    profile: null,
    phrases: { next: "next", repeat: "repeat", stop: "stop" },
    counts: { next: 0, repeat: 0, stop: 0 },
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
    ...over,
  };
}

/** A profile that has already been trained and saved. */
function savedProfile(over: Partial<VoiceProfile> = {}): VoiceProfile {
  return {
    id: "profile-1",
    phrases: { next: "下一個", repeat: "再嚟一次", stop: "停" },
    counts: { next: 4, repeat: 4, stop: 4 },
    enabled: true,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    trainedAt: 1_700_000_000_000,
    ...over,
  };
}

let onClose: Mock<() => void>;
let onChanged: Mock<() => void>;

/** Open the dialog on a given state. */
function show(state: Partial<VoiceTrainerState> = {}) {
  const profile = state.profile ?? null;
  // The trainer hands over the saved names with the profile, so the two are
  // put together here rather than in every test.
  const phrases = state.phrases ??
    profile?.phrases ?? { next: "next", repeat: "repeat", stop: "stop" };
  h.set(baseState({ ...state, phrases }));
  return render(
    <VoiceCommands
      trainer={h.trainer as unknown as VoiceTrainer}
      onClose={onClose}
      onChanged={onChanged}
    />,
  );
}

/** Move the dialog on to another state, the way the trainer would. */
function moveTo(patch: Partial<VoiceTrainerState>) {
  act(() => {
    h.set(baseState({ ...(h.box.state as VoiceTrainerState), ...patch }));
  });
}

beforeEach(() => {
  onClose = vi.fn<() => void>();
  onChanged = vi.fn<() => void>();
});

describe("VoiceCommands", () => {
  it("asks for the three names, and says what each one does", () => {
    show();

    const next = screen.getByLabelText(/next.*plays the next chunk/i) as HTMLInputElement;
    const repeat = screen.getByLabelText(/repeat.*says this chunk again/i) as HTMLInputElement;
    const stop = screen.getByLabelText(
      /stop.*stops, and again to end the run/i,
    ) as HTMLInputElement;

    expect(next.value).toBe("next");
    expect(repeat.value).toBe("repeat");
    expect(stop.value).toBe("stop");
    expect(screen.getByText(/built-in words are/i)).toBeTruthy();
  });

  it("shows the names that were saved", () => {
    show({ profile: savedProfile() });

    const next = screen.getByLabelText(/next.*plays the next chunk/i) as HTMLInputElement;

    expect(next.value).toBe("下一個");
  });

  it("calls setPhrases when a name is typed", () => {
    show();

    fireEvent.change(screen.getByLabelText(/repeat.*says this chunk again/i), {
      target: { value: "again please" },
    });

    expect(h.trainer.setPhrases).toHaveBeenCalledWith({
      next: "next",
      repeat: "again please",
      stop: "stop",
    });
  });

  it("says what is wrong with the names", () => {
    show({ phraseError: "Each command needs a different name." });

    expect(screen.getByText("Each command needs a different name.")).toBeTruthy();
  });

  it("says the recording happens on the device and is not kept", () => {
    show();

    expect(screen.getByText(/happens on this device/i)).toBeTruthy();
    expect(screen.getByText(/never kept/i)).toBeTruthy();
  });

  it("starts the recording when the app is taught, after saying the microphone will be asked for", () => {
    show();

    expect(screen.getByText(/ask for the microphone/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start recording" }));

    expect(h.trainer.beginTraining).toHaveBeenCalled();
  });

  it("shows how many samples each command and the room have", () => {
    show({ stage: "record", counts: { next: 2, repeat: 0, stop: 4 }, noise: 1 });

    expect(screen.getByText("2 of 6 samples")).toBeTruthy();
    expect(screen.getByText("0 of 6 samples")).toBeTruthy();
    expect(screen.getByText("4 of 6 samples")).toBeTruthy();
    expect(screen.getByText("1 of 4 samples")).toBeTruthy();
  });

  it("records the sample that is needed next", () => {
    show({ stage: "record" });

    fireEvent.click(screen.getByRole("button", { name: "Start recording" }));

    expect(h.trainer.recordNext).toHaveBeenCalled();
  });

  it("carries on recording by itself, and can be told not to", () => {
    show({ stage: "record" });

    const keep = screen.getByLabelText(/keep recording the next sample by itself/i);
    expect((keep as HTMLInputElement).checked).toBe(true);

    fireEvent.click(keep);

    expect(h.trainer.setAuto).toHaveBeenCalledWith(false);
  });

  it("says what is being recorded right now", () => {
    show({ stage: "record", busy: true, recording: "next" });

    expect(screen.getByText(/recording .next./i)).toBeTruthy();
  });

  it("says what is coming next", () => {
    show({ stage: "record", busy: true, upcoming: "repeat" });

    expect(screen.getByText(/next: .repeat./i)).toBeTruthy();
  });

  it("lets the recording be stopped", () => {
    show({ stage: "record", busy: true, recording: "next" });

    fireEvent.click(screen.getByRole("button", { name: /stop recording/i }));

    expect(h.trainer.stopRecording).toHaveBeenCalled();
  });

  it("takes one sample back without a button that says so in words", () => {
    show({ stage: "record", counts: { next: 2, repeat: 0, stop: 0 }, noise: 0 });

    fireEvent.click(screen.getByRole("button", { name: /undo one next sample/i }));

    expect(h.trainer.undo).toHaveBeenCalledWith("next");
  });

  it("will not take back a sample that was never recorded", () => {
    show({ stage: "record", counts: { next: 0, repeat: 0, stop: 0 }, noise: 0 });

    const undo = screen.getByRole("button", {
      name: /undo one next sample/i,
    }) as HTMLButtonElement;

    expect(undo.disabled).toBe(true);
  });

  it("shows one number of samples, not two", () => {
    show({ stage: "record", counts: { next: 0, repeat: 0, stop: 0 }, noise: 0 });

    expect(screen.getAllByText("0 of 6 samples")).toHaveLength(3);
    // The count on the row and the count of what is still needed were two
    // different numbers, which made the same thing look like two things.
    expect(screen.queryByText(/still needed before it can be trained/i)).toBeNull();
  });

  it("will not train until every command and the room have enough samples", () => {
    show({ stage: "record", counts: { next: 4, repeat: 4, stop: 3 }, noise: 3 });

    const train = screen.getByRole("button", { name: "Train" }) as HTMLButtonElement;

    expect(train.disabled).toBe(true);
    fireEvent.click(train);
    expect(h.trainer.train).not.toHaveBeenCalled();
  });

  it("trains once the minimums are met", () => {
    show({ stage: "record", counts: { next: 4, repeat: 4, stop: 4 }, noise: 3 });

    const train = screen.getByRole("button", { name: "Train" }) as HTMLButtonElement;

    expect(train.disabled).toBe(false);
    fireEvent.click(train);
    expect(h.trainer.train).toHaveBeenCalled();
  });

  it("shows how the training is getting on", () => {
    show({ stage: "train", progress: { epoch: 3, epochs: 20 } });

    expect(screen.getByText(/epoch 3 of 20/i)).toBeTruthy();
  });

  it("says that it is working while the model is being got ready", () => {
    show({ stage: "train", progress: { epoch: 0, epochs: 20 } });

    expect(screen.getByText(/getting the speech model ready/i)).toBeTruthy();
  });

  it("says that it is working when something slow is happening", () => {
    show({ stage: "names", busy: true });

    expect(screen.getByText(/working — this can take a few seconds/i)).toBeTruthy();
  });

  it("shows what the trained model heard and saves it", async () => {
    show({ stage: "test", test: { correct: 17, total: 18 } });

    expect(screen.getByText(/heard 17 of your 18 samples correctly/i)).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    expect(h.trainer.save).toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalled();
  });

  it("can be heard out before it is saved", async () => {
    show({ stage: "test", test: { correct: 17, total: 18 } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try it out" }));
    });

    expect(h.trainer.liveTest).toHaveBeenCalled();
  });

  it("says what the live test heard", () => {
    show({ stage: "test", heard: "下一個" });

    expect(screen.getByText(/it heard “下一個”/i)).toBeTruthy();
  });

  it("says the commands are in use once they have been saved", () => {
    show({ stage: "saved", enabled: true });

    expect(screen.getByText(/commands are in use/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Done" })).toBeTruthy();
  });

  it("says they are still switched off when they were saved switched off", () => {
    show({ stage: "saved", enabled: false });

    // Saying they are in use would be a lie: the built-in words are still
    // what a dictation listens for.
    expect(screen.queryByText(/commands are in use/i)).toBeNull();
    expect(screen.getByText(/switched off/i)).toBeTruthy();
    expect(screen.getByLabelText(/use my words instead of the built-in ones/i)).toBeTruthy();
  });

  it("shows what is saved and what can be done with it", () => {
    show({ profile: savedProfile() });

    expect(screen.getByText(/12 samples/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try them" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Record new ones" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete these commands" })).toBeTruthy();
    expect(screen.getByLabelText(/use my words instead of the built-in ones/i)).toBeTruthy();
  });

  it("says what recording new ones does, and what deleting does", () => {
    show({ profile: savedProfile() });

    expect(screen.getByText(/the ones you have now keep working/i)).toBeTruthy();
    expect(screen.getByText(/deleting them puts the built-in words back/i)).toBeTruthy();
  });

  it("asks before it removes the commands, and only removes on the second tap", () => {
    show({ profile: savedProfile() });

    fireEvent.click(screen.getByRole("button", { name: "Delete these commands" }));

    expect(h.trainer.remove).not.toHaveBeenCalled();
    const really = screen.getByRole("button", { name: "Really delete them?" });
    fireEvent.click(really);

    expect(h.trainer.remove).toHaveBeenCalled();
  });

  it("puts the delete button back when something else is tapped", () => {
    show({ profile: savedProfile() });

    fireEvent.click(screen.getByRole("button", { name: "Delete these commands" }));
    expect(screen.getByRole("button", { name: "Really delete them?" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Try them" }));

    expect(screen.getByRole("button", { name: "Delete these commands" })).toBeTruthy();
  });

  it("says that the names are only labels, and that saying something else means recording again", () => {
    show({ profile: savedProfile() });

    expect(screen.getByText(/names are only labels/i)).toBeTruthy();
    expect(screen.getByText(/saying something different means recording it again/i)).toBeTruthy();
  });

  it("saves the names on their own, without recording anything again", () => {
    show({ profile: savedProfile(), phrases: { next: "go", repeat: "再嚟一次", stop: "停" } });

    fireEvent.click(screen.getByRole("button", { name: "Save the names" }));

    expect(h.trainer.rename).toHaveBeenCalled();
    expect(h.trainer.beginTraining).not.toHaveBeenCalled();
  });

  it("does not offer to save the names when they have not changed", () => {
    show({ profile: savedProfile() });

    expect(screen.queryByRole("button", { name: "Save the names" })).toBeNull();
  });

  it("will not save names that are wrong", () => {
    show({
      profile: savedProfile(),
      phrases: { next: "go", repeat: "go", stop: "停" },
      phraseError: "Each command needs a different name.",
    });

    const saveNames = screen.getByRole("button", { name: "Save the names" }) as HTMLButtonElement;

    expect(saveNames.disabled).toBe(true);
  });

  it("records again straight away, because nothing is lost until it is saved", () => {
    show({ profile: savedProfile() });

    fireEvent.click(screen.getByRole("button", { name: "Record new ones" }));

    expect(h.trainer.beginTraining).toHaveBeenCalled();
  });

  it("will not record new ones while the names are wrong", () => {
    show({ profile: savedProfile(), phraseError: "Give every command a name." });

    const again = screen.getByRole("button", { name: "Record new ones" }) as HTMLButtonElement;

    expect(again.disabled).toBe(true);
  });

  it("switches the commands off", () => {
    show({ profile: savedProfile(), enabled: true });

    const use = screen.getByLabelText(/use my words instead of the built-in ones/i);
    expect((use as HTMLInputElement).checked).toBe(true);

    fireEvent.click(use);

    expect(h.trainer.setEnabled).toHaveBeenCalledWith(false);
  });

  it("says what went wrong", () => {
    show({ error: "the microphone could not be opened" });

    const error = screen.getByText("the microphone could not be opened");

    expect(error).toBeTruthy();
    expect(error.className).toContain("bad");
  });

  it("asks before it throws away recordings that were never trained", () => {
    show({ stage: "record", unsaved: true });

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/have not been trained yet/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close anyway" }));

    expect(onClose).toHaveBeenCalled();
    expect(h.trainer.discard).toHaveBeenCalled();
  });

  it("keeps the recordings when the question is called off", () => {
    show({ stage: "record", unsaved: true });

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });

  it("closes straight away when there is nothing to lose", () => {
    show();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalled();
    expect(h.trainer.discard).toHaveBeenCalled();
  });

  it("asks before it throws away names that were never saved", () => {
    show({
      profile: savedProfile(),
      phrases: { next: "go", repeat: "再嚟一次", stop: "停" },
      stage: "record",
      unsaved: true,
    });

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    // A name that was typed and never saved is just as easy to lose as a
    // sample that was never trained.
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/names that have not been saved/i)).toBeTruthy();
  });

  it("offers to keep the names before the dialog goes", async () => {
    show({
      profile: savedProfile(),
      phrases: { next: "go", repeat: "再嚟一次", stop: "停" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save the names" }));
    });

    expect(h.trainer.rename).toHaveBeenCalled();
    // The fake does not keep the names, so the dialog stays open.
    expect(onClose).not.toHaveBeenCalled();
  });

  it("says why the names were not saved, where the question is", async () => {
    show({
      profile: savedProfile(),
      phrases: { next: "go", repeat: "再嚟一次", stop: "停" },
    });
    // The trainer says what went wrong, as it does when a write fails.
    h.trainer.rename.mockImplementation(async () => {
      h.set(
        baseState({
          ...(h.box.state as VoiceTrainerState),
          error: "your voice commands could not be renamed — try again",
        }),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save the names" }));
    });

    // The reason is in the question, which is where the person is looking:
    // at the top of a long dialog it would be out of sight.
    expect(screen.getByText(/could not be renamed/i)).toBeTruthy();
    // And it is said once, not twice.
    expect(screen.getAllByText(/could not be renamed/i)).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("will not save names that are wrong, from the closing question either", () => {
    show({
      profile: savedProfile(),
      phrases: { next: "go", repeat: "go", stop: "停" },
      phraseError: "Each command needs a different name.",
    });

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    const saveNames = screen.getByRole("button", { name: "Save the names" }) as HTMLButtonElement;

    expect(saveNames.disabled).toBe(true);
    // And the reason is said where the question is, not only at the top.
    expect(screen.getAllByText(/each command needs a different name/i)).toHaveLength(1);
  });

  it("does not save the names twice when the button is tapped twice", async () => {
    show({
      profile: savedProfile(),
      phrases: { next: "go", repeat: "再嚟一次", stop: "停" },
    });
    let release: () => void = () => {};
    h.trainer.rename.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    const save = screen.getByRole("button", { name: "Save the names" }) as HTMLButtonElement;
    await act(async () => {
      // Both taps in one go: the second one must be turned away before the
      // first has finished, which is before the button can be disabled.
      fireEvent.click(save);
      fireEvent.click(save);
    });

    expect(h.trainer.rename).toHaveBeenCalledTimes(1);
    // And the buttons say so while it is going on.
    expect(save.disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    await act(async () => {
      release();
    });
  });

  it("says a later failure in the question too, and not only the first one", async () => {
    show({
      profile: savedProfile(),
      phrases: { next: "go", repeat: "再嚟一次", stop: "停" },
    });
    // The rename fails, so the question says why.
    h.trainer.rename.mockImplementation(async () => {
      h.set(
        baseState({
          ...(h.box.state as VoiceTrainerState),
          error: "your voice commands could not be renamed — try again",
        }),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save the names" }));
    });

    // Something else goes wrong while the question is still up.
    h.trainer.liveTest.mockImplementation(async () => {
      h.set(
        baseState({
          ...(h.box.state as VoiceTrainerState),
          error: "the live test could not be heard",
        }),
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try them" }));
    });

    // It is said in the question, where the person is looking: the rest of
    // the dialog is not live while the question is up, so a reason shown
    // there would go unread.
    expect(screen.getAllByText(/live test could not be heard/i)).toHaveLength(1);
    // And the first failure is still said, once.
    expect(screen.getAllByText(/could not be renamed/i)).toHaveLength(1);
  });

  it("makes the rest of the dialog not live while the question is up", () => {
    show({
      profile: savedProfile(),
      phrases: { next: "go", repeat: "再嚟一次", stop: "停" },
    });

    // Before the question, everything is as it was.
    expect(screen.getByRole("button", { name: "Try them" }).closest("[inert]")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    // Nothing behind the question can be used: a recording must not start
    // behind it, and the commands must not be taken away from under it.
    expect(screen.getByRole("button", { name: "Try them" }).closest("[inert]")).toBeTruthy();
    // The question itself is still usable.
    expect(screen.getByRole("button", { name: "Cancel" }).closest("[inert]")).toBeNull();
    // And it has the focus, so the keyboard is not left behind.
    expect(document.activeElement?.classList.contains("voice-confirm")).toBe(true);
  });

  it("closes once the names have been kept", async () => {
    const phrases = { next: "go", repeat: "再嚟一次", stop: "停" };
    show({ profile: savedProfile(), phrases });
    h.trainer.rename.mockImplementation(async () => {
      h.set(baseState({ profile: savedProfile({ phrases }), phrases, stage: "names" }));
    });

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save the names" }));
    });

    expect(onClose).toHaveBeenCalled();
    expect(h.trainer.discard).toHaveBeenCalled();
  });

  it("closes when the Escape key is pressed", () => {
    show();

    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));

    expect(onClose).toHaveBeenCalled();
  });

  it("opens as a dialog, so the recording has the screen to itself", () => {
    show();

    expect(screen.getByRole("dialog", { name: /voice commands/i })).toBeTruthy();
  });

  it("follows the state of the trainer as it moves along", () => {
    show();

    expect(screen.queryByRole("button", { name: "Train" })).toBeNull();

    moveTo({ stage: "record" });

    expect(screen.getByRole("button", { name: "Train" })).toBeTruthy();
  });
});
