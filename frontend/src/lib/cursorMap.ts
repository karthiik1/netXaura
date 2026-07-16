// Air-cursor mapping (§6.3): turns a mirrored frame-space hand point into a
// screen-space cursor position. Pure + side-effect free so the mapping math is
// unit-testable without the webcam pipeline; useGestureRecognition feeds the
// result through a One-Euro filter for smoothing.

// A comfortable central box of the camera frame, mapped to the WHOLE screen, so
// every corner is reachable with relaxed motion and small moves in the middle
// aren't cramped. Numbers are the fraction of the frame the box spans on each
// axis — tuned for an arm's-length webcam and adjustable per setup.
export const CURSOR_BOX = { x0: 0.2, x1: 0.8, y0: 0.14, y1: 0.74 };

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// Mirrored frame point (x already flipped) -> screen space. Rescales the box to
// [0,1] and clamps, so the edges are reachable and off-box motion parks at the
// border instead of being lost.
export function remapCursor(x: number, y: number): { x: number; y: number } {
  const rx = (x - CURSOR_BOX.x0) / (CURSOR_BOX.x1 - CURSOR_BOX.x0);
  const ry = (y - CURSOR_BOX.y0) / (CURSOR_BOX.y1 - CURSOR_BOX.y0);
  return { x: clamp01(rx), y: clamp01(ry) };
}
