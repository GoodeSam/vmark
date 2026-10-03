// WI-RA25.1 — sanitizeMediaHtml keeps an iframe only at a video embed origin:
// the hosts the app builds embeds on, which are also all the release CSP lets
// a frame load from. YouTube embeds use the privacy-enhanced host, so an
// iframe on youtube.com is not one; neither is plain http, another port, a
// lookalike host, or a URL carrying credentials.
import { describe, expect, it } from "vitest";
import { sanitizeMediaHtml } from "./sanitize";

const iframe = (src: string) => `<iframe src="${src}" width="560" height="315"></iframe>`;

describe("sanitizeMediaHtml — embed origins", () => {
  it.each([
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    "https://WWW.YOUTUBE-NOCOOKIE.COM/embed/dQw4w9WgXcQ",
    "https://www.youtube-nocookie.com:443/embed/dQw4w9WgXcQ",
    "https://player.vimeo.com/video/123456789?h=a1b2c3d4e5",
    "https://player.bilibili.com/player.html?bvid=BV1xx411c7mD",
  ])("keeps an iframe on %s", (src) => {
    expect(sanitizeMediaHtml(iframe(src))).toContain("<iframe");
  });

  it.each([
    ["youtube.com", "https://www.youtube.com/embed/dQw4w9WgXcQ"],
    ["youtube.com without www", "https://youtube.com/embed/dQw4w9WgXcQ"],
    ["the privacy-enhanced domain without www", "https://youtube-nocookie.com/embed/dQw4w9WgXcQ"],
    ["plain http", "http://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"],
    ["another port", "https://www.youtube-nocookie.com:8443/embed/dQw4w9WgXcQ"],
    ["credentials", "https://user:pw@www.youtube-nocookie.com/embed/dQw4w9WgXcQ"],
    ["a lookalike host", "https://www.youtube-nocookie.com.evil.example/embed/x"],
    ["the provider's page host", "https://vimeo.com/123456789"],
    ["a relative src", "/embed/dQw4w9WgXcQ"],
    ["an empty src", ""],
    ["a non-http scheme", "javascript:alert(1)"],
  ])("strips an iframe on %s", (_case, src) => {
    expect(sanitizeMediaHtml(iframe(src))).not.toContain("<iframe");
  });

  it("judges every iframe on its own", () => {
    const result = sanitizeMediaHtml(
      iframe("https://www.youtube.com/embed/dQw4w9WgXcQ") +
        iframe("https://player.vimeo.com/video/123456789"),
    );
    expect(result).toContain("player.vimeo.com");
    expect(result).not.toContain("www.youtube.com");
  });
});
