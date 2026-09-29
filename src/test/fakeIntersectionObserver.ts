/**
 * A controllable IntersectionObserver for jsdom, which has none.
 *
 * Nothing intersects until a test says so with `trigger()`, and the geometry
 * reported is whatever the test hands it — jsdom lays nothing out.
 *
 * @module test/fakeIntersectionObserver
 */
import { vi } from "vitest";

export class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];

  readonly root: Element | Document | null;
  readonly rootMargin: string;
  readonly thresholds: readonly number[] = [0];
  readonly observed = new Set<Element>();
  private readonly callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit = {}) {
    this.callback = callback;
    this.root = options.root ?? null;
    this.rootMargin = options.rootMargin ?? "0px";
    FakeIntersectionObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.observed.add(target);
  }

  unobserve(target: Element): void {
    this.observed.delete(target);
  }

  disconnect(): void {
    this.observed.clear();
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  /**
   * Report `targets` (default: everything observed) as intersecting, each at
   * the given vertical offset (default 0) as its bounding box top.
   */
  trigger(targets: Element[] = [...this.observed], topOf: (el: Element) => number = () => 0): void {
    const entries = targets.map((target) => {
      const top = topOf(target);
      const rect = { top, bottom: top + 20, left: 0, right: 100, width: 100, height: 20, x: 0, y: top } as DOMRectReadOnly;
      return {
        target,
        isIntersecting: true,
        intersectionRatio: 1,
        boundingClientRect: rect,
        intersectionRect: rect,
        rootBounds: null,
        time: 0,
      } as IntersectionObserverEntry;
    });
    this.callback(entries, this as unknown as IntersectionObserver);
  }
}

/** Install the fake as the global IntersectionObserver for this test. */
export function installFakeIntersectionObserver(): void {
  FakeIntersectionObserver.instances = [];
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
}

/** The single observer the code under test created. */
export function onlyObserver(): FakeIntersectionObserver {
  const [observer, ...rest] = FakeIntersectionObserver.instances;
  if (!observer || rest.length > 0) {
    throw new Error(`expected exactly one IntersectionObserver, got ${FakeIntersectionObserver.instances.length}`);
  }
  return observer;
}
