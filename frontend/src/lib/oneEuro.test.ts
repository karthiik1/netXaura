import { describe, expect, it } from "vitest";

import { OneEuroFilter, OneEuroPoint2D } from "./oneEuro";

describe("OneEuroFilter", () => {
  it("passes the first sample through unchanged", () => {
    const f = new OneEuroFilter();
    expect(f.filter(0.42, 0)).toBe(0.42);
  });

  it("suppresses jitter around a stationary value", () => {
    const f = new OneEuroFilter();
    // Noisy hover around 0.5 at 60fps.
    let out = f.filter(0.5, 0);
    for (let i = 1; i <= 120; i++) {
      const noise = (i % 2 === 0 ? 1 : -1) * 0.02;
      out = f.filter(0.5 + noise, i * 16.7);
    }
    // Raw signal oscillates ±0.02; filtered output should be far tighter.
    expect(Math.abs(out - 0.5)).toBeLessThan(0.01);
  });

  it("tracks fast movement with little lag", () => {
    const f = new OneEuroFilter();
    // A fast sweep: 0 -> 1 over ~250ms at 60fps.
    let out = 0;
    for (let i = 0; i <= 15; i++) {
      out = f.filter(i / 15, i * 16.7);
    }
    // Adaptive cutoff should keep the filtered value close to the target.
    expect(out).toBeGreaterThan(0.85);
  });

  it("resets cleanly", () => {
    const f = new OneEuroFilter();
    f.filter(0.9, 0);
    f.filter(0.9, 16);
    f.reset();
    expect(f.filter(0.1, 32)).toBe(0.1); // treated as a fresh first sample
  });

  it("treats non-monotonic timestamps as a restart instead of dividing by zero", () => {
    const f = new OneEuroFilter();
    f.filter(0.5, 100);
    expect(Number.isFinite(f.filter(0.7, 100))).toBe(true);
    expect(Number.isFinite(f.filter(0.7, 50))).toBe(true);
  });
});

describe("OneEuroPoint2D", () => {
  it("filters both axes independently", () => {
    const f = new OneEuroPoint2D();
    const first = f.filter({ x: 0.2, y: 0.8 }, 0);
    expect(first).toEqual({ x: 0.2, y: 0.8 });
    const second = f.filter({ x: 0.3, y: 0.7 }, 16.7);
    expect(second.x).toBeGreaterThan(0.2);
    expect(second.x).toBeLessThan(0.3);
    expect(second.y).toBeLessThan(0.8);
    expect(second.y).toBeGreaterThan(0.7);
  });
});
