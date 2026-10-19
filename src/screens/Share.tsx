import { useEffect, useMemo, useRef, useState, type FocusEvent } from "react";
import { encodeSetup, MAX_PAYLOAD_CHARS, shareUrl, type SharedSetup } from "../domain/share";
import { DENSE_CONTENT_CHARS, MAX_CONTENT_CHARS, qrCode, qrPath } from "../lib/qr";

interface Props {
  setup: SharedSetup;
  onClose: () => void;
}

type Copy = "idle" | "copied" | "failed";

/**
 * Hand a dictation to somebody else.
 *
 * The link carries the whole Setup, so there is nothing to upload and nothing to
 * fetch: it opens without a server, and offline. That is also why it is deflated
 * and why it rides in the fragment rather than the query string — see
 * src/domain/share.ts.
 *
 * A dialog, because the one thing this has to do is show a code to somebody
 * else's camera, and that wants the whole screen rather than a slot in a
 * scrolling form.
 */
export function Share({ setup, onClose }: Props) {
  const [link, setLink] = useState<string | null>(null);
  const [copy, setCopy] = useState<Copy>("idle");
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    // showModal brings focus containment, Esc and an inert background with it.
    // A browser without it gets a plain panel rather than an exception.
    if (typeof el.showModal === "function") el.showModal();
    else el.setAttribute("open", "");
  }, []);

  useEffect(() => {
    let live = true;
    void encodeSetup(setup).then((payload) => {
      // Past this the app itself would refuse to reopen the link, so offering
      // one would be a lie with extra steps.
      if (live) setLink(payload.length > MAX_PAYLOAD_CHARS ? "" : shareUrl(payload));
    });
    return () => {
      live = false;
    };
  }, [setup]);

  const tooLong = link === "";
  const content = link ?? "";
  const shareable = link !== null && !tooLong;
  const scannable = content.length > 0 && content.length <= MAX_CONTENT_CHARS;
  const dense = scannable && content.length > DENSE_CONTENT_CHARS;

  const code = useMemo(() => (scannable ? qrPath(qrCode(content)) : null), [scannable, content]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(content);
      setCopy("copied");
    } catch {
      setCopy("failed");
    }
  }

  return (
    <dialog className="share" aria-labelledby="share-title" ref={dialog} onCancel={onClose}>
      <h2 className="share-title" id="share-title">
        Share this dictation
      </h2>
      <p className="share-sub">
        Nothing is uploaded — the dictation travels inside the link, and opens with the language and
        the text already filled in.
      </p>

      {link === null && <p className="note">Packing it up…</p>}

      {tooLong && (
        <p className="note bad">
          This dictation is too long to share as a link — it would come to more than{" "}
          {MAX_PAYLOAD_CHARS} characters, and the app would refuse to open it again. Copy the text
          by hand instead.
        </p>
      )}

      {shareable && (
        <>
          {code && (
            <div className="qr">
              <svg
                viewBox={`0 0 ${code.size} ${code.size}`}
                role="img"
                aria-label="QR code carrying this dictation"
              >
                <rect width="100%" height="100%" fill="#fff" />
                <path d={code.d} fill="#000" shapeRendering="crispEdges" />
              </svg>
            </div>
          )}

          {dense && (
            <p className="note">
              That code is dense. If a camera will not take it, send the link instead.
            </p>
          )}
          {!scannable && (
            <p className="note">
              Too long for a QR code to hold. Send the link instead — it carries the whole thing.
            </p>
          )}

          <input
            className="share-link"
            readOnly
            value={content}
            onFocus={selectAll}
            aria-label="Link to this dictation"
          />
        </>
      )}

      <div className="share-actions">
        {shareable && (
          <button className="btn primary" onClick={() => void copyLink()}>
            Copy link
          </button>
        )}
        <button className="btn" onClick={onClose}>
          Close
        </button>
      </div>

      {copy === "copied" && <p className="note good">Copied to the clipboard.</p>}
      {copy === "failed" && (
        <p className="note bad">Copy failed — the link above can be selected by hand.</p>
      )}
    </dialog>
  );
}

/** A long link is useless to tap unless it all gets selected. */
function selectAll(e: FocusEvent<HTMLInputElement>) {
  e.currentTarget.select();
}
