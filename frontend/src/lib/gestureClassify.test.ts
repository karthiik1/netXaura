// The gesture vocabulary (§6), tested without a camera.
//
// MediaPipe hands us 21 landmarks; the classifier only ever reads geometry, so
// synthetic hands exercise the real thresholds. `makeHand` builds a plausible
// right hand from per-finger extended/curled flags, in the same normalized
// 0-1 space MediaPipe reports: y grows downward, so an extended finger reaches
// UP (smaller y) away from the wrist, and a curled one folds its tip back to
// its own knuckle.
import { describe, expect, it } from "vitest";

import {
  bothFist,
  bothOpen,
  classifyOneHand,
  FIST_FOLD_MAX,
  type Hand,
  handSize,
  isExtended,
  INDEX_MCP,
  INDEX_TIP,
  pinchDistance,
  type Point,
} from "./gestureClassify";

const WRIST_AT = { x: 0.5, y: 0.9 };
// Wrist -> middle MCP is the hand-size reference: 0.9 - 0.6 = 0.3.
const MIDDLE_MCP_Y = 0.6;

interface FingerGeom {
  x: number;
  mcpY: number;
  mcp: number;
  pip: number;
  dip: number;
  tip: number;
}

const FINGERS: Record<"index" | "middle" | "ring" | "pinky", FingerGeom> = {
  index: { x: 0.44, mcpY: 0.62, mcp: 5, pip: 6, dip: 7, tip: 8 },
  middle: { x: 0.5, mcpY: MIDDLE_MCP_Y, mcp: 9, pip: 10, dip: 11, tip: 12 },
  ring: { x: 0.56, mcpY: 0.62, mcp: 13, pip: 14, dip: 15, tip: 16 },
  pinky: { x: 0.62, mcpY: 0.66, mcp: 17, pip: 18, dip: 19, tip: 20 },
};

interface Spec {
  index?: boolean;
  middle?: boolean;
  ring?: boolean;
  pinky?: boolean;
  /** "away" = thumb nowhere near the index; "touch" = thumb tip on the index tip. */
  thumb?: "away" | "touch";
  /**
   * Index curled by the wrist test, but its tip reaching across the palm toward
   * the thumb rather than folded onto its knuckle — the pose FIST_FOLD_MAX
   * exists to tell apart from a real fist.
   */
  indexReaching?: boolean;
  /** Uniform scale about the wrist — a hand nearer to / further from the camera. */
  scale?: number;
}

function makeHand(spec: Spec): Hand {
  const pts: Point[] = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  const put = (i: number, x: number, y: number) => (pts[i] = { x, y, z: 0 });

  put(0, WRIST_AT.x, WRIST_AT.y);

  for (const [name, g] of Object.entries(FINGERS) as [keyof typeof FINGERS, FingerGeom][]) {
    const extended = spec[name] ?? false;
    put(g.mcp, g.x, g.mcpY);
    if (extended) {
      put(g.pip, g.x, g.mcpY - 0.08);
      put(g.dip, g.x, g.mcpY - 0.14);
      put(g.tip, g.x, g.mcpY - 0.2);
    } else {
      put(g.pip, g.x, g.mcpY - 0.04);
      put(g.dip, g.x, g.mcpY - 0.01);
      put(g.tip, g.x + 0.01, g.mcpY + 0.01); // tip folded back onto the knuckle
    }
  }

  if (spec.indexReaching) {
    const g = FINGERS.index;
    put(g.pip, g.x, g.mcpY - 0.04); // still curled by the wrist test...
    put(g.tip, 0.26, 0.7); // ...but the tip is way off its knuckle
  }

  // Thumb: only the tip (4) is read. The other joints trail plausibly behind it.
  const idxTip = pts[INDEX_TIP];
  const thumbTip =
    spec.thumb === "touch" ? { x: idxTip.x + 0.02, y: idxTip.y + 0.02 } : { x: 0.28, y: 0.74 };
  put(1, 0.42, 0.84);
  put(2, 0.37, 0.8);
  put(3, (0.37 + thumbTip.x) / 2, (0.8 + thumbTip.y) / 2);
  put(4, thumbTip.x, thumbTip.y);

  if (spec.scale && spec.scale !== 1) {
    const s = spec.scale;
    return pts.map((p) => ({
      x: WRIST_AT.x + (p.x - WRIST_AT.x) * s,
      y: WRIST_AT.y + (p.y - WRIST_AT.y) * s,
      z: 0,
    }));
  }
  return pts;
}

const ALL_UP: Spec = { index: true, middle: true, ring: true, pinky: true };
const gesture = (s: Spec) => classifyOneHand(makeHand(s), 0.9).gesture;

describe("makeHand fixture", () => {
  it("builds a hand whose extension flags match what the classifier reads", () => {
    const open = makeHand({ ...ALL_UP, thumb: "away" });
    for (const tip of [8, 12, 16, 20]) expect(isExtended(open, tip)).toBe(true);

    const closed = makeHand({ thumb: "away" });
    for (const tip of [8, 12, 16, 20]) expect(isExtended(closed, tip)).toBe(false);
  });

  it("uses wrist -> middle-MCP as the hand-size reference", () => {
    expect(handSize(makeHand(ALL_UP))).toBeCloseTo(0.3, 6);
  });
});

describe("classifyOneHand", () => {
  it("reads four fingers up with the thumb clear as an open palm", () => {
    expect(gesture({ ...ALL_UP, thumb: "away" })).toBe("open_palm");
  });

  it("reads a thumb-index circle with the other three up as OK, not an open palm", () => {
    // Same four fingers as the open palm above — only the thumb moved.
    expect(gesture({ ...ALL_UP, thumb: "touch" })).toBe("ok");
  });

  it("reads index + middle up as two fingers", () => {
    expect(gesture({ index: true, middle: true, thumb: "away" })).toBe("two_fingers");
  });

  it("reads index only as a point", () => {
    expect(gesture({ index: true, thumb: "away" })).toBe("point");
  });

  it("reads every finger folded onto its knuckle as a fist", () => {
    expect(gesture({ thumb: "away" })).toBe("fist");
  });

  it("returns none for a pose outside the vocabulary", () => {
    // Middle up alone: not a point, not a V, not a fist.
    expect(gesture({ middle: true, thumb: "away" })).toBe("none");
  });

  it("passes MediaPipe's presence through as confidence, and scores none at 0", () => {
    expect(classifyOneHand(makeHand({ ...ALL_UP, thumb: "away" }), 0.83).confidence).toBe(0.83);
    expect(classifyOneHand(makeHand({ middle: true, thumb: "away" }), 0.83).confidence).toBe(0);
  });
});

describe("fist vs. an index reaching for the thumb (FIST_FOLD_MAX)", () => {
  it("does not call it a fist when the index reaches across instead of folding", () => {
    const h = makeHand({ indexReaching: true, thumb: "touch" });
    // Curled by the wrist test — the fold ratio is the only thing separating
    // this from a real fist.
    expect(isExtended(h, INDEX_TIP)).toBe(false);
    const fold = Math.hypot(h[INDEX_TIP].x - h[INDEX_MCP].x, h[INDEX_TIP].y - h[INDEX_MCP].y) / handSize(h);
    expect(fold).toBeGreaterThan(FIST_FOLD_MAX);
    expect(classifyOneHand(h, 0.9).gesture).not.toBe("fist");
  });

  it("calls it a fist once the same hand folds its index home", () => {
    const h = makeHand({ thumb: "touch" });
    const fold = Math.hypot(h[INDEX_TIP].x - h[INDEX_MCP].x, h[INDEX_TIP].y - h[INDEX_MCP].y) / handSize(h);
    expect(fold).toBeLessThan(FIST_FOLD_MAX);
    expect(classifyOneHand(h, 0.9).gesture).toBe("fist");
  });
});

describe("normalization (§6.3)", () => {
  it("classifies the same pose the same at any distance from the camera", () => {
    for (const scale of [0.4, 0.7, 1, 1.6, 2.5]) {
      expect(gesture({ ...ALL_UP, thumb: "away", scale })).toBe("open_palm");
      expect(gesture({ ...ALL_UP, thumb: "touch", scale })).toBe("ok");
      expect(gesture({ thumb: "away", scale })).toBe("fist");
      expect(gesture({ index: true, thumb: "away", scale })).toBe("point");
    }
  });

  it("keeps the thumb-index distance scale-invariant", () => {
    const near = pinchDistance(makeHand({ ...ALL_UP, thumb: "touch", scale: 2.5 }));
    const far = pinchDistance(makeHand({ ...ALL_UP, thumb: "touch", scale: 0.4 }));
    expect(near).toBeCloseTo(far, 6);
  });
});

describe("two-handed poses", () => {
  const open = () => makeHand({ ...ALL_UP, thumb: "away" });
  const fist = () => makeHand({ thumb: "away" });

  it("needs exactly two hands", () => {
    expect(bothOpen([open()])).toBe(false);
    expect(bothOpen([open(), open(), open()])).toBe(false);
    expect(bothFist([fist()])).toBe(false);
  });

  it("recognizes both palms open and both fists closed", () => {
    expect(bothOpen([open(), open()])).toBe(true);
    expect(bothFist([fist(), fist()])).toBe(true);
  });

  it("rejects a mismatched pair, so a half-made pose never fires", () => {
    expect(bothOpen([open(), fist()])).toBe(false);
    expect(bothFist([fist(), open()])).toBe(false);
  });

  it("still recognizes them when the two hands are at different distances", () => {
    expect(bothOpen([open(), makeHand({ ...ALL_UP, thumb: "away", scale: 1.8 })])).toBe(true);
    expect(bothFist([fist(), makeHand({ thumb: "away", scale: 0.5 })])).toBe(true);
  });

  // Both paths must agree on what a fist is: a hand the one-handed classifier
  // refuses to call a fist cannot become one just because there are two of it.
  // Two fists confirm a whole-workspace move, so this is the expensive one to
  // get wrong.
  it("applies the same fold guard as the one-handed fist", () => {
    const reaching = makeHand({ indexReaching: true, thumb: "touch" });
    expect(classifyOneHand(reaching, 0.9).gesture).not.toBe("fist");
    expect(bothFist([reaching, reaching])).toBe(false);
  });

  it("still accepts a real pair of fists", () => {
    expect(bothFist([fist(), fist()])).toBe(true);
  });
});
