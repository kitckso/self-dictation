import { useEffect, useMemo, useState } from "react";
import {
  drillText,
  groupByLanguage,
  itemProgress,
  pickRandom,
  RANDOM_DRILL_SIZE,
  runText,
  summarise,
  weaknesses,
  type ItemProgress,
  type WeaknessGroup,
} from "../domain/progress";
import { languageById, type LanguageId, type Run, type SetupFill } from "../domain/types";
import { clearRuns, deleteRun, listAllRuns } from "../storage/db";

/**
 * How many past Runs the screen lists.
 *
 * Progress still works out of every Run there is: this is only about how many
 * of them the list shows.
 */
const PAST_RUNS_SHOWN = 20;

interface Props {
  onBack: () => void;
  /** Start a Run over some material, chosen from here. */
  onDrill: (fill: SetupFill) => void;
  onStorageFail: () => void;
}

/** How long ago a Run was, in words a person would use. */
function ago(at: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(at).toLocaleDateString();
}

/**
 * What the person is being asked to confirm, or null.
 *
 * Forgetting a Run is permanent and undoes the record of how they did, so both
 * the ✕ and "Forget every run" ask before they take anything away.
 */
type Confirming = { kind: "run"; id: string } | { kind: "all" } | null;

/** Whether the row for this Run is currently being asked about forgetting. */
function askingAboutRun(asking: Confirming, id: string): boolean {
  return asking?.kind === "run" && asking.id === id;
}

/**
 * What the last copy attempt did, and to which Language's material.
 *
 * Every group of Weaknesses has its own Copy button, so the note has to say
 * which one was used: "Copied" beside the wrong list would be a lie.
 */
type Copy = { language: LanguageId; ok: boolean } | null;

/** The title for a drill over some material. */
function drillTitle(language: string, count: number): string {
  return `Needs practice — ${language} (${count})`;
}

export function History({ onBack, onDrill, onStorageFail }: Props) {
  const [runs, setRuns] = useState<Run[] | null>(null);
  /** Whether the store could not be read at all. */
  const [unreadable, setUnreadable] = useState(false);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [copy, setCopy] = useState<Copy>(null);

  useEffect(() => {
    void listAllRuns()
      .then(setRuns)
      .catch(() => {
        // The store cannot be read, and a blocked store will not fix itself.
        // An empty list rather than a wait that never ends: the person still
        // has to be able to leave this screen and get on with a dictation.
        setRuns([]);
        setUnreadable(true);
        onStorageFail();
      });
  }, [onStorageFail]);

  const summaries = useMemo(() => (runs ?? []).map(summarise), [runs]);
  const weak = useMemo(() => weaknesses(itemProgress(runs ?? [])), [runs]);
  const groups = useMemo(() => groupByLanguage(weak), [weak]);

  async function remove(id: string) {
    try {
      await deleteRun(id);
      setRuns((prev) => (prev ?? []).filter((r) => r.id !== id));
    } catch {
      onStorageFail();
    }
  }

  async function clear() {
    try {
      await clearRuns();
      setRuns([]);
    } catch {
      onStorageFail();
    }
  }

  function drill(items: ItemProgress[]) {
    const language = items[0]?.language;
    if (!language) return;
    onDrill({
      language,
      // A Run speaks one Language, so the material has to be one Language's.
      mode: "vocab",
      title: drillTitle(languageById(language).label, items.length),
      text: drillText(items),
    });
  }

  /**
   * Put the Weaknesses on the clipboard, one per line.
   *
   * The same text a Drill is made of, so it can be pasted somewhere else — into
   * a document, or into another app's Setup.
   */
  async function copyItems(group: WeaknessGroup) {
    try {
      await navigator.clipboard.writeText(drillText(group.items));
      setCopy({ language: group.language, ok: true });
    } catch {
      setCopy({ language: group.language, ok: false });
    }
  }

  function again(run: Run) {
    onDrill({
      language: run.language,
      mode: run.mode,
      title: run.title,
      text: runText(run),
    });
  }

  const now = Date.now();

  return (
    <div className="pad stack">
      <header className="su-head">
        <h1>Your progress</h1>
      </header>

      {runs === null ? (
        <p className="note">Looking for your past runs…</p>
      ) : unreadable ? (
        // There is nothing to show: the store could not be read at all. Saying
        // "Nothing yet" underneath would claim it is empty instead.
        <p className="note bad">
          Your past runs could not be read. This browser is blocking storage — private browsing or a
          full store is the usual reason.
        </p>
      ) : (
        <>
          {groups.length > 0 && (
            <section>
              <p className="lbl">Needs practice</p>
              {groups.map((group) => (
                <div className="saved" key={group.language}>
                  <p className="note">
                    {languageById(group.language).label} · {group.items.length} item
                    {group.items.length === 1 ? "" : "s"}
                  </p>
                  {group.items.map((item) => (
                    <div className="saved-row" key={`${group.language}:${item.text}`}>
                      <span className="nm">{item.text}</span>
                      <span className="chip">
                        {item.correct} right · {item.wrong} wrong
                        {item.partial > 0 ? ` · ${item.partial} half` : ""}
                      </span>
                    </div>
                  ))}
                  <button
                    className="btn"
                    onClick={() => drill(group.items)}
                    // The visible words come first, so the accessible name still
                    // contains what the button says on screen.
                    aria-label={`Drill these ${group.items.length} ${languageById(group.language).label} items`}
                  >
                    Drill these {group.items.length}
                  </button>
                  <button
                    className="btn"
                    onClick={() => void copyItems(group)}
                    // The visible words come first, so the accessible name still
                    // contains what the button says on screen.
                    aria-label={`Copy these ${group.items.length} ${languageById(group.language).label} items to the clipboard`}
                  >
                    Copy these {group.items.length}
                  </button>
                  {group.items.length > RANDOM_DRILL_SIZE && (
                    <button
                      className="btn"
                      onClick={() => drill(pickRandom(group.items, RANDOM_DRILL_SIZE))}
                      aria-label={`Random ${RANDOM_DRILL_SIZE} of these ${languageById(group.language).label} items`}
                    >
                      Random {RANDOM_DRILL_SIZE}
                    </button>
                  )}
                  {copy?.language === group.language && (
                    <p className={copy.ok ? "note good" : "note bad"} role="status">
                      {copy.ok
                        ? "Copied to the clipboard, one item per line."
                        : "Copy failed — the browser would not take it."}
                    </p>
                  )}
                </div>
              ))}
            </section>
          )}

          <section>
            <p className="lbl">Past runs</p>
            {summaries.length === 0 ? (
              <p className="note">
                Nothing yet. A Run is kept here once you mark something in it, so you can see how
                you are doing and come back to the material that caught you out.
              </p>
            ) : (
              <div className="saved">
                {summaries.slice(0, PAST_RUNS_SHOWN).map(({ run, score, answered }) => (
                  <div className="saved-row" key={run.id}>
                    <span className="chip">{languageById(run.language).label}</span>
                    <span className="nm">
                      {run.title} · {ago(run.startedAt, now)}
                    </span>
                    <span className="chip">
                      {score === null ? "—" : `${Math.round(score * 100)}%`} · {answered}/
                      {run.chunks.length}
                    </span>
                    <button
                      className="rowbtn"
                      onClick={() => again(run)}
                      aria-label={`Practise ${run.title} again`}
                    >
                      again
                    </button>
                    {askingAboutRun(confirming, run.id) ? (
                      <>
                        <span className="confirm-note" role="status">
                          Forget this run?
                        </span>
                        <button
                          className="rowbtn"
                          // The ✕ that asked has just gone, taking keyboard
                          // focus with it; put focus on the answer instead.
                          autoFocus
                          onClick={() => {
                            setConfirming(null);
                            void remove(run.id);
                          }}
                        >
                          forget
                        </button>
                        <button className="rowbtn" onClick={() => setConfirming(null)}>
                          keep
                        </button>
                      </>
                    ) : (
                      <button
                        className="rowbtn"
                        onClick={() => setConfirming({ kind: "run", id: run.id })}
                        aria-label={`Forget the run of ${run.title}`}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {summaries.length > PAST_RUNS_SHOWN && (
              <p className="note">
                {summaries.length - PAST_RUNS_SHOWN} older runs are not listed, but they still count
                towards what needs practice.
              </p>
            )}
          </section>

          {summaries.length > 0 &&
            (confirming?.kind === "all" ? (
              <>
                <button
                  className="btn"
                  autoFocus
                  onClick={() => {
                    setConfirming(null);
                    void clear();
                  }}
                >
                  Yes, forget every run
                </button>
                <button className="btn" onClick={() => setConfirming(null)}>
                  Keep them
                </button>
              </>
            ) : (
              <button className="btn" onClick={() => setConfirming({ kind: "all" })}>
                Forget every run
              </button>
            ))}
        </>
      )}

      {/* Always here, so that a store which cannot be read cannot trap anyone. */}
      <button className="btn primary" onClick={onBack}>
        New dictation
      </button>
    </div>
  );
}
