// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeSetup, payloadFromHash, type SharedSetup } from "../domain/share";
import { DENSE_CONTENT_CHARS } from "../lib/qr";
import { Share } from "./Share";

const setup: SharedSetup = {
  language: "yue",
  mode: "paragraph",
  title: "晨早新聞",
  text: "今日天氣唔錯。我打算去公園散步。",
};

/** Characters as unlike each other as they are unlike Latin, so a passage cannot be deflated away. */
function ramblingText(chars: number): string {
  return Array.from({ length: chars }, (_, i) => String.fromCharCode(0x4e00 + ((i * 37) % 20000)))
    .join("")
    .normalize("NFC");
}

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
}

function stubShare(share: (data: ShareData) => Promise<void>) {
  Object.defineProperty(navigator, "share", { value: share, configurable: true });
}

/** The link the panel put in front of the user, or null when it drew none. */
function shownLink(): string | null {
  const field = screen.queryByDisplayValue(/self-dictation\.netlify\.app\/#d=/);
  return field ? (field as HTMLInputElement).value : null;
}

/** The link, once the panel has finished encoding. */
async function linkShown(): Promise<string> {
  const field = await screen.findByDisplayValue(/self-dictation\.netlify\.app\/#d=/);
  return (field as HTMLInputElement).value;
}

function payloadOf(link: string): string | null {
  return payloadFromHash(new URL(link).hash);
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, "clipboard");
  Reflect.deleteProperty(navigator, "share");
});

describe("Share", () => {
  it("opens as a dialog, so the code has the screen to itself", async () => {
    render(<Share setup={setup} onClose={() => {}} />);
    await linkShown();

    expect(screen.getByRole("dialog", { name: /share this dictation/i })).toBeTruthy();
  });

  it("hands over a link that carries the dictation itself", async () => {
    render(<Share setup={setup} onClose={() => {}} />);

    const payload = payloadOf(await linkShown());

    expect(payload && (await decodeSetup(payload))).toEqual(setup);
  });

  it("draws a code to scan", async () => {
    const { container } = render(<Share setup={setup} onClose={() => {}} />);
    await linkShown();

    const svg = container.querySelector("svg");
    const box = svg?.getAttribute("viewBox") ?? "";
    const [x, y, width, height] = box.split(" ").map(Number);
    expect(svg?.querySelector("path")?.getAttribute("d")?.length).toBeGreaterThan(0);
    expect([x, y]).toEqual([0, 0]);
    expect(width).toBe(height);
    expect(width).toBeGreaterThan(21);
  });

  it("copies the link", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    render(<Share setup={setup} onClose={() => {}} />);
    const link = await linkShown();

    fireEvent.click(screen.getByRole("button", { name: /copy link/i }));

    expect(writeText).toHaveBeenCalledWith(link);
    expect(await screen.findByText(/copied/i)).toBeTruthy();
  });

  it("says so when the browser refuses the clipboard", async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    render(<Share setup={setup} onClose={() => {}} />);
    await linkShown();

    fireEvent.click(screen.getByRole("button", { name: /copy link/i }));

    expect(await screen.findByText(/copy failed/i)).toBeTruthy();
  });

  it("hands the link to the system share sheet when there is one", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    stubShare(share);
    render(<Share setup={setup} onClose={() => {}} />);
    const link = await linkShown();

    fireEvent.click(screen.getByRole("button", { name: /^share/i }));

    expect(share).toHaveBeenCalledWith({ title: "晨早新聞", url: link });
  });

  it("does not call closing the share sheet a failure", async () => {
    const cancelled = Object.assign(new Error("cancelled"), { name: "AbortError" });
    const share = vi.fn().mockRejectedValue(cancelled);
    stubShare(share);
    render(<Share setup={setup} onClose={() => {}} />);
    await linkShown();

    fireEvent.click(screen.getByRole("button", { name: /^share/i }));

    await waitFor(() => expect(share).toHaveBeenCalled());
    expect(screen.queryByText(/share sheet/i)).toBeNull();
  });

  it("says so when the share sheet cannot be opened", async () => {
    stubShare(vi.fn().mockRejectedValue(new Error("no share targets")));
    render(<Share setup={setup} onClose={() => {}} />);
    await linkShown();

    fireEvent.click(screen.getByRole("button", { name: /^share/i }));

    expect(await screen.findByText(/could not open the share sheet/i)).toBeTruthy();
  });

  it("offers only copying when the browser has no share sheet", async () => {
    render(<Share setup={setup} onClose={() => {}} />);
    await linkShown();

    expect(screen.queryByRole("button", { name: /^share/i })).toBeNull();
    expect(screen.getByRole("button", { name: /copy link/i })).toBeTruthy();
  });

  it("warns when the code it would draw is too dense to scan", async () => {
    const dense: SharedSetup = { ...setup, text: ramblingText(350) };
    render(<Share setup={dense} onClose={() => {}} />);
    const link = await linkShown();

    expect(shownLink()).not.toBeNull();
    expect(payloadOf(link)!.length).toBeGreaterThan(DENSE_CONTENT_CHARS);
    expect(screen.getByText(/dense/i)).toBeTruthy();
  });

  it("draws no code for a link too long to be one, but still offers the link", async () => {
    const long: SharedSetup = { ...setup, text: ramblingText(1000) };
    const { container } = render(<Share setup={long} onClose={() => {}} />);
    const link = await linkShown();

    expect(container.querySelector("svg")).toBeNull();
    expect(screen.getByText(/too long for a qr/i)).toBeTruthy();
    expect(payloadOf(link)).not.toBeNull();
  });

  it("refuses to hand over a link the app itself could not open", async () => {
    const absurd: SharedSetup = { ...setup, text: ramblingText(3000) };
    render(<Share setup={absurd} onClose={() => {}} />);

    expect(await screen.findByText(/too long to share/i)).toBeTruthy();
    expect(shownLink()).toBeNull();
  });

  it("closes when asked", async () => {
    const onClose = vi.fn();
    render(<Share setup={setup} onClose={onClose} />);
    await linkShown();

    fireEvent.click(screen.getByRole("button", { name: /close/i }));

    expect(onClose).toHaveBeenCalled();
  });
});
