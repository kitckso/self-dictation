import { describe, expect, it } from "vitest";
import { speechCommandUrls } from "./modelUrls";

describe("speechCommandUrls", () => {
  it("makes the model and metadata absolute, as the loader requires", () => {
    expect(speechCommandUrls("/", "https://example.com/")).toEqual({
      model: "https://example.com/models/speech-commands/18w/model.json",
      metadata: "https://example.com/models/speech-commands/18w/metadata.json",
    });
  });

  it("keeps a deployed base path", () => {
    expect(
      speechCommandUrls("/self-dictation/", "https://example.com/self-dictation/"),
    ).toEqual({
      model: "https://example.com/self-dictation/models/speech-commands/18w/model.json",
      metadata: "https://example.com/self-dictation/models/speech-commands/18w/metadata.json",
    });
  });

  it("resolves a relative base against the page", () => {
    expect(speechCommandUrls("./", "https://example.com/self-dictation/").model).toBe(
      "https://example.com/self-dictation/models/speech-commands/18w/model.json",
    );
  });
});
