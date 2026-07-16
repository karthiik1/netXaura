// Procedural low-poly twilight cityscape (§landing spec 1). Drawn on canvas —
// a fixed seed keeps the skyline identical across paints while staying crisp
// at any viewport size, unlike a raster background.
import { useEffect, useRef } from "react";

function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 20260714;

function lerpColor(c1: string, c2: string, t: number) {
  const p = (c: string, i: number) => parseInt(c.slice(i, i + 2), 16);
  const ch = (i: number) => Math.round(p(c1, i) + (p(c2, i) - p(c1, i)) * t);
  return `rgb(${ch(1)},${ch(3)},${ch(5)})`;
}

function render(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w === 0 || h === 0) return;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const rng = mulberry32(SEED);

  // Sky: deep purple → magenta dusk → peach → gold at the horizon.
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#241640");
  sky.addColorStop(0.32, "#4C2F63");
  sky.addColorStop(0.55, "#B4557A");
  sky.addColorStop(0.72, "#E8794F");
  sky.addColorStop(0.86, "#F4A261");
  sky.addColorStop(1, "#FBCB8F");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // Sun bloom low in the valley, kept soft so hero copy above stays legible.
  const sun = ctx.createRadialGradient(w / 2, h * 0.5, 0, w / 2, h * 0.5, Math.min(w, h) * 0.28);
  sun.addColorStop(0, "rgba(255,236,210,0.65)");
  sun.addColorStop(0.35, "rgba(255,200,150,0.25)");
  sun.addColorStop(1, "rgba(255,200,150,0)");
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, w, h);

  // Soft cloud banks hugging the mountain line.
  ctx.save();
  ctx.filter = "blur(14px)";
  for (let i = 0; i < 7; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.1 + rng() * 0.14})`;
    ctx.beginPath();
    const rw = w * (0.08 + rng() * 0.1);
    ctx.ellipse(w * (0.08 + rng() * 0.84), h * (0.4 + rng() * 0.16), rw, rw * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Two jagged mountain layers with sunlit facets.
  const mountains = (baseY: number, amp: number, step: number, near: string, far: string, alpha: number) => {
    const pts: Array<[number, number]> = [];
    for (let x = -step; x <= w + step; x += step) pts.push([x, baseY - rng() * amp]);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(0, h);
    pts.forEach(([x, y]) => ctx.lineTo(x, y));
    ctx.lineTo(w, h);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, baseY - amp, 0, h);
    g.addColorStop(0, far);
    g.addColorStop(1, near);
    ctx.fillStyle = g;
    ctx.fill();
    // Light catches the sun-facing slope of each peak.
    ctx.globalAlpha = alpha * 0.55;
    ctx.fillStyle = "rgba(255,205,150,0.35)";
    for (let i = 1; i < pts.length - 1; i += 2) {
      const [, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[i + 1];
      if (y1 < y0 - 6 && y1 < y2 - 6) {
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.lineTo((x1 + x2) / 2, y1 + (y2 - y1) * 0.55 + amp * 0.12);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  };
  mountains(h * 0.5, h * 0.1, w / 22, "#3A2555", "#6B4A72", 0.55);
  mountains(h * 0.58, h * 0.16, w / 16, "#241536", "#4F3260", 0.85);

  // City blocks flanking the river; towers rise toward the waterfront.
  const riverHalf = w * 0.025;
  const cluster = (side: "left" | "right") => {
    const edgeX = side === "left" ? 0 : w;
    const innerX = side === "left" ? w / 2 - riverHalf : w / 2 + riverHalf;
    const clusterW = Math.abs(innerX - edgeX);
    const n = 8 + Math.floor(rng() * 3);
    const slots = Array.from({ length: n }, () => 0.6 + rng());
    const slotSum = slots.reduce((a, b) => a + b, 0);
    let cursor = side === "left" ? 0 : innerX;
    for (let i = 0; i < n; i++) {
      const bw = (slots[i] / slotSum) * clusterW;
      const distFromRiver = side === "left" ? innerX - (cursor + bw) : cursor - innerX;
      const proximity = 1 - Math.min(1, Math.max(0, distFromRiver / clusterW));
      const bh = h * (0.16 + proximity * 0.34 + rng() * 0.12);
      const by = h - bh;
      const isGlass = proximity > 0.55 && rng() > 0.4;
      if (isGlass) {
        const gg = ctx.createLinearGradient(cursor, by, cursor, h);
        gg.addColorStop(0, "#F0996B");
        gg.addColorStop(0.5, "#7A4A78");
        gg.addColorStop(1, "#2E1C46");
        ctx.fillStyle = gg;
      } else {
        ctx.fillStyle = lerpColor("#1B1030", "#3A2555", proximity);
      }
      ctx.fillRect(cursor, by, bw, bh);
      if (isGlass) {
        ctx.save();
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = "#FFE6C2";
        const bands = 3 + Math.floor(rng() * 3);
        for (let b = 0; b < bands; b++) ctx.fillRect(cursor + 2, by + (bh / bands) * b + 2, bw - 4, 2);
        ctx.restore();
      } else {
        const cols = Math.max(2, Math.round(bw / 14));
        const rows = Math.max(3, Math.round(bh / 16));
        const gw = bw / cols;
        const gh = bh / rows;
        const pad = Math.min(gw, gh) * 0.28;
        const lit = 0.4 + proximity * 0.25;
        for (let c = 0; c < cols; c++) {
          for (let r = 0; r < rows; r++) {
            if (rng() > lit) continue;
            const ww = gw - pad * 2;
            const wh = gh - pad * 2;
            if (ww <= 0 || wh <= 0) continue;
            ctx.fillStyle = rng() > 0.75 ? "rgba(255,255,255,0.85)" : "rgba(255,206,138,0.9)";
            ctx.fillRect(cursor + c * gw + pad, by + r * gh + pad, ww, wh);
          }
        }
      }
      cursor += bw;
    }
  };
  cluster("left");
  cluster("right");

  // The river: a bright wedge reflecting the dusk, widening to the viewer.
  const horizonY = h * 0.56;
  const topW = w * 0.05;
  const botW = w * 0.3;
  const riverPath = () => {
    ctx.beginPath();
    ctx.moveTo(w / 2 - topW / 2, horizonY);
    ctx.lineTo(w / 2 + topW / 2, horizonY);
    ctx.lineTo(w / 2 + botW / 2, h);
    ctx.lineTo(w / 2 - botW / 2, h);
    ctx.closePath();
  };
  const water = ctx.createLinearGradient(0, horizonY, 0, h);
  water.addColorStop(0, "#F6C79A");
  water.addColorStop(0.25, "#D98E7C");
  water.addColorStop(0.6, "#6C4470");
  water.addColorStop(1, "#2A1B42");
  riverPath();
  ctx.fillStyle = water;
  ctx.fill();
  ctx.save();
  riverPath();
  ctx.clip();
  for (let i = 0; i < 26; i++) {
    const t = rng();
    const lw = (topW + (botW - topW) * t) * (0.3 + rng() * 0.55);
    ctx.fillStyle = `rgba(255,255,255,${0.08 + rng() * 0.16})`;
    ctx.fillRect(w / 2 - lw / 2 + (rng() - 0.5) * lw * 0.4, horizonY + t * (h - horizonY), lw, 1 + rng() * 1.6);
  }
  ctx.restore();
  const glow = ctx.createRadialGradient(w / 2, horizonY, 0, w / 2, horizonY, w * 0.05);
  glow.addColorStop(0, "rgba(255,240,220,0.55)");
  glow.addColorStop(1, "rgba(255,240,220,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(w / 2 - w * 0.05, horizonY - w * 0.05, w * 0.1, w * 0.1);

  // Rocky foreground banks with cone trees, silhouetted.
  (["left", "right"] as const).forEach((side) => {
    const edge = side === "left" ? 0 : w;
    const dir = side === "left" ? 1 : -1;
    const baseW = w * 0.22;
    ctx.fillStyle = "#140B22";
    ctx.beginPath();
    ctx.moveTo(edge, h);
    const steps = 6;
    for (let i = 0; i <= steps; i++) {
      ctx.lineTo(edge + dir * baseW * (i / steps), h - h * 0.1 * rng() * (1 - i / steps + 0.15));
    }
    ctx.lineTo(edge + dir * baseW, h);
    ctx.closePath();
    ctx.fill();
    for (let i = 0; i < 3; i++) {
      const tx = edge + dir * baseW * (0.15 + rng() * 0.6);
      const th = h * (0.05 + rng() * 0.04);
      const ty = h - h * 0.035 - rng() * h * 0.02;
      ctx.fillStyle = "#0F0819";
      ctx.beginPath();
      ctx.moveTo(tx, ty - th);
      ctx.lineTo(tx - th * 0.275, ty);
      ctx.lineTo(tx + th * 0.275, ty);
      ctx.closePath();
      ctx.fill();
    }
  });

  // Bottom vignette so hero copy and the seam line sit on quiet ground.
  const vig = ctx.createLinearGradient(0, h * 0.7, 0, h);
  vig.addColorStop(0, "rgba(20,11,33,0)");
  vig.addColorStop(1, "rgba(15,8,22,0.55)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, w, h);
  const edges = ctx.createLinearGradient(0, 0, w, 0);
  edges.addColorStop(0, "rgba(10,6,18,0.28)");
  edges.addColorStop(0.15, "rgba(10,6,18,0)");
  edges.addColorStop(0.85, "rgba(10,6,18,0)");
  edges.addColorStop(1, "rgba(10,6,18,0.28)");
  ctx.fillStyle = edges;
  ctx.fillRect(0, 0, w, h);
}

export function SunsetCityscape({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let raf = 0;
    const paint = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => render(canvas));
    };
    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(canvas);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  return <canvas ref={ref} aria-hidden className={`block h-full w-full ${className}`} />;
}
