// One-Euro filter (Casiez et al., CHI 2012) for the air cursor (§6). Plain
// low-pass smoothing trades jitter for lag; the One-Euro filter adapts its
// cutoff to speed — heavy smoothing when the hand hovers (kills jitter), light
// smoothing when it sweeps (kills lag). Pure and side-effect free for tests.

interface OneEuroOptions {
  /** Baseline cutoff (Hz) when nearly still. Lower = smoother but laggier. */
  minCutoff?: number;
  /** How aggressively cutoff rises with speed. Values are tuned for inputs in
   * normalized [0,1] screen units, where a fast hand sweep is ~1-3 units/s. */
  beta?: number;
  /** Cutoff (Hz) for the internal derivative estimate. */
  dCutoff?: number;
}

function smoothingFactor(cutoffHz: number, dtSeconds: number): number {
  const r = 2 * Math.PI * cutoffHz * dtSeconds;
  return r / (r + 1);
}

export class OneEuroFilter {
  private readonly minCutoff: number;
  private readonly beta: number;
  private readonly dCutoff: number;
  private prev: { value: number; derivative: number; timestampMs: number } | null =
    null;

  constructor({ minCutoff = 1.0, beta = 6.0, dCutoff = 1.0 }: OneEuroOptions = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  filter(value: number, timestampMs: number): number {
    if (this.prev === null || timestampMs <= this.prev.timestampMs) {
      this.prev = { value, derivative: 0, timestampMs };
      return value;
    }
    const dt = (timestampMs - this.prev.timestampMs) / 1000;

    const rawDerivative = (value - this.prev.value) / dt;
    const aD = smoothingFactor(this.dCutoff, dt);
    const derivative =
      aD * rawDerivative + (1 - aD) * this.prev.derivative;

    const cutoff = this.minCutoff + this.beta * Math.abs(derivative);
    const a = smoothingFactor(cutoff, dt);
    const filtered = a * value + (1 - a) * this.prev.value;

    this.prev = { value: filtered, derivative, timestampMs };
    return filtered;
  }

  reset(): void {
    this.prev = null;
  }
}

/** Paired filters for a 2D point (the air cursor). */
export class OneEuroPoint2D {
  private readonly fx: OneEuroFilter;
  private readonly fy: OneEuroFilter;

  constructor(options?: OneEuroOptions) {
    this.fx = new OneEuroFilter(options);
    this.fy = new OneEuroFilter(options);
  }

  filter(p: { x: number; y: number }, timestampMs: number): { x: number; y: number } {
    return {
      x: this.fx.filter(p.x, timestampMs),
      y: this.fy.filter(p.y, timestampMs),
    };
  }

  reset(): void {
    this.fx.reset();
    this.fy.reset();
  }
}
