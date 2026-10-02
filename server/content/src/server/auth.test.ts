// Phase 4 / VULN-001 — auth guard: nonce mint/consume, TTL, cookie flags.
// WI-8.3 — security-review outcome (VULN-001 nonce auth) coverage.
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { createAuthGuard, SESSION_COOKIE, NONCE_TTL_MS } from "./auth";

const BOOTSTRAP = "port-file-token";

function appWith(now: () => number) {
  const guard = createAuthGuard({ bootstrapToken: BOOTSTRAP, now });
  const app = new Hono();
  app.get("/__mint", (c) => guard.handleMint(c));
  app.get("/__auth", (c) => guard.handleBootstrap(c));
  app.use("*", guard.middleware);
  app.get("/__health", (c) => c.json({ ok: true }));
  return { app, guard };
}

async function mint(app: Hono): Promise<string> {
  const res = await app.request("/__mint", { headers: { authorization: `Bearer ${BOOTSTRAP}` } });
  return ((await res.json()) as { nonce: string }).nonce;
}

describe("createAuthGuard", () => {
  it("mints a nonce only with the correct bearer", async () => {
    const { app } = appWith(() => 0);
    const ok = await app.request("/__mint", { headers: { authorization: `Bearer ${BOOTSTRAP}` } });
    expect(ok.status).toBe(200);
    const bad = await app.request("/__mint", { headers: { authorization: "Bearer nope" } });
    expect(bad.status).toBe(403);
    const none = await app.request("/__mint");
    expect(none.status).toBe(403);
  });

  it("sets HttpOnly + SameSite=Strict cookie on nonce bootstrap", async () => {
    const { app } = appWith(() => 0);
    const nonce = await mint(app);
    const res = await app.request(`/__auth?t=${nonce}`, { redirect: "manual" });
    expect(res.status).toBe(302);
    const sc = res.headers.get("set-cookie") ?? "";
    expect(sc).toContain(SESSION_COOKIE);
    expect(sc.toLowerCase()).toContain("httponly");
    expect(sc).toContain("SameSite=Strict");
  });

  it("rejects the long-lived token at /__auth (never accepted in URL)", async () => {
    const { app } = appWith(() => 0);
    const res = await app.request(`/__auth?t=${BOOTSTRAP}`, { redirect: "manual" });
    expect(res.status).toBe(403);
  });

  it("nonce is single-use", async () => {
    const { app } = appWith(() => 0);
    const nonce = await mint(app);
    expect((await app.request(`/__auth?t=${nonce}`, { redirect: "manual" })).status).toBe(302);
    expect((await app.request(`/__auth?t=${nonce}`, { redirect: "manual" })).status).toBe(403);
  });

  it("nonce expires after the TTL", async () => {
    let t = 1_000;
    const { app } = appWith(() => t);
    const nonce = await mint(app);
    t += NONCE_TTL_MS + 1; // advance past expiry
    const res = await app.request(`/__auth?t=${nonce}`, { redirect: "manual" });
    expect(res.status).toBe(403);
  });

  it("bootstrap redirect carries the session token in ?s (grill M2)", async () => {
    const { app, guard } = appWith(() => 0);
    const nonce = await mint(app);
    const res = await app.request(`/__auth?t=${nonce}`, { redirect: "manual" });
    expect(res.headers.get("location")).toBe(`/?s=${guard.sessionToken}`);
  });

  it("accepts a valid ?s session token (cookie-blocked iframe path)", async () => {
    const { app, guard } = appWith(() => 0);
    const ok = await app.request(`/__health?s=${guard.sessionToken}`);
    expect(ok.status).toBe(200);
    const bad = await app.request("/__health?s=wrong");
    expect(bad.status).toBe(401);
  });
});

// WI-RA8.3 — `next` is a same-origin PATH, judged by a URL parser rather than
// by the shape of its first two characters.
describe("the next= destination of /__auth", () => {
  /** Bootstrap with `next` and return where the 302 points. */
  async function locationFor(next: string): Promise<{ location: string; token: string }> {
    const { app, guard } = appWith(() => 0);
    const nonce = await mint(app);
    const res = await app.request(`/__auth?t=${nonce}&next=${encodeURIComponent(next)}`, {
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    return { location: res.headers.get("location") ?? "", token: guard.sessionToken };
  }

  it.each([
    ["a backslash the browser reads as a slash", "/\\evil.com"],
    ["two backslashes", "/\\\\evil.com"],
    ["protocol-relative", "//evil.com"],
    ["protocol-relative with a path", "//evil.com/a/b"],
    ["a tab between the slashes", "/\t/evil.com"],
    ["a newline between the slashes", "/\n/evil.com"],
    ["a carriage return and a backslash", "/\r\\evil.com"],
    ["a leading tab", "\t//evil.com"],
    ["a leading space", " //evil.com"],
    ["dot segments that collapse to //", "/..//evil.com"],
    ["a dot segment before a backslash", "/.\\/evil.com"],
    ["an absolute URL", "https://evil.com/"],
    ["a scheme with no slashes", "javascript:alert(1)"],
    ["a relative path", "evil.com"],
    ["an empty value", ""],
  ])("falls back to the default for %s", async (_label, next) => {
    const { location, token } = await locationFor(next);
    expect(location).toBe(`/?s=${token}`);
  });

  it("falls back when the backslash arrives percent-encoded in the request", async () => {
    // `/%5Cevil.com` written into the URL by hand: the query parser decodes it
    // to `/\evil.com` before the handler ever sees it.
    const { app, guard } = appWith(() => 0);
    const nonce = await mint(app);
    const res = await app.request(`/__auth?t=${nonce}&next=/%5Cevil.com`, { redirect: "manual" });
    expect(res.headers.get("location")).toBe(`/?s=${guard.sessionToken}`);
  });

  it("keeps a still-encoded backslash as an ordinary path on this origin", async () => {
    const { location, token } = await locationFor("/%5Cevil.com");
    expect(location).toBe(`/%5Cevil.com?s=${token}`);
    // Resolved by a browser against the server, it never leaves the server.
    expect(new URL(location, "http://127.0.0.1:4321").host).toBe("127.0.0.1:4321");
  });

  it.each([
    ["/slidev/", (t: string) => `/slidev/?s=${t}`],
    ["/note/A.md", (t: string) => `/note/A.md?s=${t}`],
    ["/note/dir/B.md?view=raw", (t: string) => `/note/dir/B.md?view=raw&s=${t}`],
    ["/note/笔记.md", (t: string) => `/note/%E7%AC%94%E8%AE%B0.md?s=${t}`],
    ["/@evil.com", (t: string) => `/@evil.com?s=${t}`],
  ])("redirects to the ordinary path %s", async (next, expected) => {
    const { location, token } = await locationFor(next);
    expect(location).toBe(expected(token));
  });

  it("replaces a session parameter the destination already carries", async () => {
    // The guard reads the FIRST `s`; a stale one ahead of the real one is a 401.
    const { location, token } = await locationFor("/note/A.md?s=stale&view=raw");
    expect(location).toBe(`/note/A.md?s=${token}&view=raw`);
  });

  it("puts the session before a fragment, where the server can read it", async () => {
    const { location, token } = await locationFor("/note/A.md#heading");
    expect(location).toBe(`/note/A.md?s=${token}#heading`);
  });

  it("never points off the server, whatever the value", async () => {
    const hostile = [
      "/\\evil.com",
      "//evil.com",
      "/\t/evil.com",
      "/..//evil.com",
      "/a/..//..//evil.com",
      "/\\/\\/evil.com",
      "///evil.com",
      "/%2F/evil.com",
      "/%5Cevil.com",
    ];
    for (const next of hostile) {
      const { location } = await locationFor(next);
      expect(location.startsWith("/"), `${next} → ${location}`).toBe(true);
      expect(new URL(location, "http://127.0.0.1:4321").host, `${next} → ${location}`).toBe(
        "127.0.0.1:4321",
      );
    }
  });
});
