// Geometric hand-pose classification (§6). Pure functions over MediaPipe
// landmarks: no React, no MediaPipe import, no I/O — so the vocabulary can be
// tested without a camera (see gestureClassify.test.ts). useGestureRecognition
// owns the camera and feeds landmarks in here.
//
// All thresholds are documented inline and tunable. Distances are normalized by
// hand size (wrist -> middle-finger MCP) so they're invariant to how near/far
// the user is from the camera (§6.3).
import type { GestureName } from "../stores/gestureStore";

export type Point = { x: number; y: number; z: number };
export type Hand = Point[];

// --- landmark indices (MediaPipe Hands topology) ---------------------------
export const WRIST = 0;
export const THUMB_TIP = 4;
export const INDEX_MCP = 5;
export const INDEX_PIP = 6;
export const INDEX_TIP = 8;
export const MIDDLE_MCP = 9;
export const MIDDLE_TIP = 12;
export const RING_TIP = 16;
export const PINKY_TIP = 20;
const FINGER_PIP = { [INDEX_TIP]: INDEX_PIP, [MIDDLE_TIP]: 10, [RING_TIP]: 14, [PINKY_TIP]: 18 };

// --- air-cursor mapping (§6.3) ---------------------------------------------
// The cursor anchors on the index KNUCKLE (MCP), not the fingertip: the knuckle
// barely moves when the finger curls, so the cursor stays put when you close a
// fist. It also jitters less than the tip.
export const CURSOR_ANCHOR = INDEX_MCP;

// --- tunable thresholds ----------------------------------------------------
export const PINCH_ON = 0.4; // normalized thumb-index distance below this = thumb+index touching
export const EXTEND_MARGIN = 1.15; // tip must be >1.15x farther from wrist than its PIP
// A fist and a thumb-to-index touch both bring those tips together; they differ
// in HOW FOLDED the index is. In a fist the index tip folds all the way back to
// its own knuckle (MCP); when it merely reaches forward to meet the thumb its
// tip stays much farther from the knuckle. This ratio (tip↔MCP over hand size)
// separates them robustly regardless of hand orientation.
export const FIST_FOLD_MAX = 0.6; // index tip↔MCP / hand-size below this = a real fist

function dist(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function handSize(h: Hand) {
  // Reference length used to normalize all other distances.
  return dist(h[WRIST], h[MIDDLE_MCP]) || 1e-6;
}

export function isExtended(h: Hand, tip: number) {
  const pip = FINGER_PIP[tip as keyof typeof FINGER_PIP];
  return dist(h[tip], h[WRIST]) > dist(h[pip], h[WRIST]) * EXTEND_MARGIN;
}

export function pinchDistance(h: Hand) {
  return dist(h[THUMB_TIP], h[INDEX_TIP]) / handSize(h);
}

export interface Classified {
  gesture: GestureName;
  confidence: number;
}

// Heuristic poses fire at MediaPipe's presence score once matched — a matched
// pose is a deliberate act, and graded sub-scores used to sit below the firing
// threshold and silently drop clean gestures (§6.4).
export function classifyOneHand(h: Hand, presence: number): Classified {
  const p = pinchDistance(h);
  const index = isExtended(h, INDEX_TIP);
  const middle = isExtended(h, MIDDLE_TIP);
  const ring = isExtended(h, RING_TIP);
  const pinky = isExtended(h, PINKY_TIP);

  // "OK": thumb+index circle AND the other three fingers up. A deliberate pose
  // — full confidence once matched (the old graded score sat below the firing
  // threshold).
  if (p < PINCH_ON && middle && ring && pinky) {
    return { gesture: "ok", confidence: presence };
  }
  // Open palm: all four fingers up (§sequence ops). The OK check above already
  // consumed the all-up-but-touching case.
  if (index && middle && ring && pinky) {
    return { gesture: "open_palm", confidence: presence };
  }
  // Two fingers ("V": index + middle up, ring + pinky curled) — op 3 copy-tab
  // arm on the source, complete on the destination.
  if (index && middle && !ring && !pinky) {
    return { gesture: "two_fingers", confidence: presence };
  }
  // Fist: all fingers curled AND the index folded all the way back to its own
  // knuckle. The fold test (not tip↔wrist reach) is what keeps an index that
  // reaches forward to the thumb from being misread as a fist.
  const indexFold = dist(h[INDEX_TIP], h[INDEX_MCP]) / handSize(h);
  if (!index && !middle && !ring && !pinky && indexFold < FIST_FOLD_MAX) {
    return { gesture: "fist", confidence: presence };
  }
  // Index point: index up, the rest curled.
  if (index && !middle && !ring && !pinky) {
    return { gesture: "point", confidence: presence };
  }
  return { gesture: "none", confidence: 0 };
}

export function bothOpen(hands: Hand[]) {
  return (
    hands.length === 2 &&
    hands.every(
      (h) =>
        isExtended(h, INDEX_TIP) &&
        isExtended(h, MIDDLE_TIP) &&
        isExtended(h, RING_TIP) &&
        isExtended(h, PINKY_TIP),
    )
  );
}

export function bothFist(hands: Hand[]) {
  return (
    hands.length === 2 &&
    hands.every(
      (h) =>
        !isExtended(h, INDEX_TIP) &&
        !isExtended(h, MIDDLE_TIP) &&
        !isExtended(h, RING_TIP) &&
        !isExtended(h, PINKY_TIP),
    )
  );
}
