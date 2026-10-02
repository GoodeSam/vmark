// WI-RA10B.10 — startup overlaps the secure-storage IPCs with the synchronous
// setup, and still evaluates App only once the secure-storage cache is filled.
// The stores are the real ones; the steps that read no store are recorded.
import { describe, it, expect, vi } from "vitest";

const events = vi.hoisted(() => [] as string[]);
const storage = vi.hoisted(() => {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { ready, release };
});

vi.mock("@/services/secrets/secureStorage", () => ({
  initSecureStorage: vi.fn(() => {
    events.push("storage:start");
    return storage.ready.then(() => events.push("storage:ready"));
  }),
}));
vi.mock("./lib/formats", () => ({ bootstrapFormats: () => events.push("formats") }));
vi.mock("./services/assembly/bindHostSettings", () => ({ bindPluginHostSettings: () => events.push("hostSettings") }));
vi.mock("./services/menu/startupMenuSync", () => ({}));
vi.mock("react-dom/client", () => ({ default: { createRoot: () => ({ render: () => events.push("render") }) } }));
// Evaluating App is what hydrates the AI provider store from the cache.
vi.mock("./App", () => {
  events.push("App:evaluated");
  return { default: () => null };
});

describe("bootstrap order", () => {
  it("runs the synchronous setup while secure storage loads, and evaluates App only after it has", async () => {
    document.body.appendChild(Object.assign(document.createElement("div"), { id: "root" }));
    await import("./main");
    await vi.waitFor(() => expect(events).toContain("formats"));

    expect(events).toEqual(["storage:start", "hostSettings", "formats"]);

    storage.release();
    await vi.waitFor(() => expect(events).toContain("render"));
    expect(events.slice(3)).toEqual(["storage:ready", "App:evaluated", "render"]);
  });
});
