import { useEffect, useMemo, useState } from "react";
import {
  drillText,
  groupByLanguage,
  itemProgress,
  runText,
  summarise,
  weaknesses,
  type ItemProgress,
} from "../domain/progress";
import { languageById, type Run, type SetupFill } from "../domain/types";
import { clearRuns, deleteRun, listRuns } from "../storage/db";

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

/** The title for a drill over some material. */
function drillTitle(language: string, count: number): string {
  return `Needs practice — ${language} (${count})`;
}

export function History({ onBack, onDrill, onStorageFail }: Props) {
  const [runs, setRuns] = useState<Run[] | null>(null);
  /** Whether the store could not be read at all. */
  const [unreadable, setUnreadable] = useState(false);

  useEffect(() => {
    void listRuns()
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
      ) : (
        <>
          {unreadable && (
            <p className="note bad">
              Your past runs could not be read. This browser is blocking storage — private browsing
              or a full store is the usual reason.
            </p>
          )}

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
                        {item.wrong} time{item.wrong === 1 ? "" : "s"}
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
                </div>
              ))}
            </section>
          )}

          <section>
            <p className="lbl">Past runs</p>
            {summaries.length === 0 ? (
              <p className="note">
                Nothing yet. A Run is saved here when it ends, so you can see how you are doing and
                come back to the material that caught you out.
              </p>
            ) : (
              <div className="saved">
                {summaries.map(({ run, score, answered }) => (
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
                    <button
                      className="rowbtn"
                      onClick={() => void remove(run.id)}
                      aria-label={`Forget the run of ${run.title}`}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {summaries.length > 0 && (
            <button className="btn" onClick={() => void clear()}>
              Forget every run
            </button>
          )}
        </>
      )}

      {/* Always here, so that a store which cannot be read cannot trap anyone. */}
      <button className="btn primary" onClick={onBack}>
        New dictation
      </button>
    </div>
  );
}
