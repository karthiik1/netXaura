import { describe, expect, it } from "vitest";

import { CURSOR_BOX, remapCursor } from "./cursorMap";

describe("remapCursor", () => {
  it("maps the box centre to the screen centre", () => {
    const cx = (CURSOR_BOX.x0 + CURSOR_BOX.x1) / 2;
    const cy = (CURSOR_BOX.y0 + CURSOR_BOX.y1) / 2;
    const p = remapCursor(cx, cy);
    expect(p.x).toBeCloseTo(0.5, 6);
    expect(p.y).toBeCloseTo(0.5, 6);
  });

  it("maps the box corners to the screen corners", () => {
    expect(remapCursor(CURSOR_BOX.x0, CURSOR_BOX.y0)).toEqual({ x: 0, y: 0 });
    expect(remapCursor(CURSOR_BOX.x1, CURSOR_BOX.y1)).toEqual({ x: 1, y: 1 });
  });

  it("amplifies motion — a small move inside the box covers more screen", () => {
    // The box is narrower than the full frame, so gain > 1: reaching the
    // screen edge doesn't require stretching to the frame edge.
    const span = CURSOR_BOX.x1 - CURSOR_BOX.x0;
    expect(span).toBeLessThan(1);
    const moved = remapCursor(CURSOR_BOX.x0 + span / 4, 0.5).x;
    expect(moved).toBeCloseTo(0.25, 6); // a quarter of the box = a quarter screen
  });

  it("clamps points outside the box to the screen edges", () => {
    expect(remapCursor(0, 0)).toEqual({ x: 0, y: 0 });
    expect(remapCursor(1, 1)).toEqual({ x: 1, y: 1 });
    expect(remapCursor(-5, 0.5).x).toBe(0);
    expect(remapCursor(5, 0.5).x).toBe(1);
  });
});
