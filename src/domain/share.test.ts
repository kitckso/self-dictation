import { describe, expect, it, vi } from "vitest";
import { decodeSetup, encodeSetup, payloadFromHash, shareUrl, type SharedSetup } from "./share";

const cantonese: SharedSetup = {
  language: "yue",
  mode: "paragraph",
  title: "晨早新聞",
  text: "今日天氣唔錯。我打算去公園散步。不過好似會落雨。不如返屋企啦。",
};

const english: SharedSetup = {
  language: "en",
  mode: "vocab",
  title: "",
  text: "library\nhospital\nairport",
};

/** A link as it would have looked before deflate existed. */
function uncompressed(setup: SharedSetup): string {
  const json = JSON.stringify(setup);
  const bytes = new TextEncoder().encode(json);
  const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  const b64 = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `1r${b64}`;
}

describe("shareUrl", () => {
  it("points a shared link at the deployed app", () => {
    expect(shareUrl("abc")).toBe("https://self-dictation.netlify.app/#d=abc");
  });
});

describe("payloadFromHash", () => {
  it("reads the payload out of a fragment", () => {
    expect(payloadFromHash("#d=1zABCD")).toBe("1zABCD");
  });

  it("finds nothing in a fragment that is not ours", () => {
    expect(payloadFromHash("")).toBeNull();
    expect(payloadFromHash("#")).toBeNull();
    expect(payloadFromHash("#anchor")).toBeNull();
    expect(payloadFromHash("#d=")).toBeNull();
  });
});

describe("encodeSetup", () => {
  it("round-trips a Cantonese passage", async () => {
    const payload = await encodeSetup(cantonese);
    expect(await decodeSetup(payload)).toEqual(cantonese);
  });

  it("round-trips English", async () => {
    const payload = await encodeSetup(english);
    expect(await decodeSetup(payload)).toEqual(english);
  });

  it("deflates, rather than merely encoding", async () => {
    const long: SharedSetup = { ...cantonese, text: cantonese.text.repeat(20) };
    const payload = await encodeSetup(long);
    expect(payload.startsWith("1z")).toBe(true);
    expect(payload.length).toBeLessThan(uncompressed(long).length);
  });

  it("produces something that needs no escaping inside a fragment", async () => {
    const payload = await encodeSetup(cantonese);
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("falls back to plain encoding where the browser has no DEFLATE", async () => {
    vi.stubGlobal("CompressionStream", undefined);
    const payload = await encodeSetup(english);
    vi.unstubAllGlobals();

    expect(payload.startsWith("1r")).toBe(true);
    expect(await decodeSetup(payload)).toEqual(english);
  });
});

describe("decodeSetup", () => {
  it("still reads a link made before deflate existed", async () => {
    expect(await decodeSetup(uncompressed(english))).toEqual(english);
  });

  it("reads the payload back out of a whole link", async () => {
    const payload = await encodeSetup(english);
    const hash = shareUrl(payload).slice(shareUrl(payload).indexOf("#"));
    const found = payloadFromHash(hash);
    expect(found && (await decodeSetup(found))).toEqual(english);
  });

  it("refuses rubbish instead of throwing", async () => {
    for (const bad of ["", "nonsense", "#", "1", "1z", "1xABCD", "9zABCD", "1r!!!!"]) {
      expect(await decodeSetup(bad)).toBeNull();
    }
  });

  it("refuses a payload that decodes to something other than a Setup", async () => {
    const encoded = (json: string) => uncompressed(JSON.parse(json) as SharedSetup);
    expect(
      await decodeSetup(encoded('{"language":"fr","mode":"vocab","title":"","text":"a"}')),
    ).toBeNull();
    expect(
      await decodeSetup(encoded('{"language":"en","mode":"nope","title":"","text":"a"}')),
    ).toBeNull();
    expect(await decodeSetup(encoded('{"language":"en","mode":"vocab","text":"a"}'))).toBeNull();
    expect(
      await decodeSetup(encoded('{"language":"en","mode":"vocab","title":7,"text":"a"}')),
    ).toBeNull();
    expect(await decodeSetup("1rRGVsZmluYXRlbHkgbm90IEpTT04=")).toBeNull();
  });

  it("refuses an absurdly long payload without trying to inflate it", async () => {
    expect(await decodeSetup(`1r${"A".repeat(9000)}`)).toBeNull();
  });
});
