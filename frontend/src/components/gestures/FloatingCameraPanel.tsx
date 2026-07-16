// Draggable floating shell for the webcam + gesture read-out. Dragging writes
// transform: translate3d directly to the DOM inside rAF (no per-frame React
// renders), so the panel tracks the pointer at frame rate. The parked position
// persists per browser.
//
// The panel has two faces: the camera, and (flipped) the room's member list.
// Both stay mounted — the camera face is only rotated out of view, so flipping
// never tears down the recognition pipeline or drops the webcam stream.
import { Users, Video } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useGestureStore } from "../../stores/gestureStore";
import { MemberList } from "../workspace/MemberList";
import type { GestureEvent } from "./useGestureRecognition";
import { WebcamFeed } from "./WebcamFeed";

const MARGIN = 12; // px the panel keeps from every viewport edge
const STORAGE_KEY = "netxaura.cameraPanel.pos";

function loadPos(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    return typeof p.x === "number" && typeof p.y === "number" ? p : null;
  } catch {
    return null;
  }
}

export function FloatingCameraPanel({ onGesture }: { onGesture: (e: GestureEvent) => void }) {
  const enabled = useGestureStore((s) => s.enabled);
  const setEnabled = useGestureStore((s) => s.setEnabled);

  const ref = useRef<HTMLDivElement>(null);
  const pos = useRef({ x: 0, y: 0 });
  const grab = useRef({ dx: 0, dy: 0 });
  const latest = useRef({ x: 0, y: 0 });
  const rafId = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [flipped, setFlipped] = useState(false);

  function clampAndApply(x: number, y: number) {
    const el = ref.current;
    if (!el) return;
    const maxX = window.innerWidth - el.offsetWidth - MARGIN;
    const maxY = window.innerHeight - el.offsetHeight - MARGIN;
    pos.current = {
      x: Math.min(Math.max(x, MARGIN), Math.max(maxX, MARGIN)),
      y: Math.min(Math.max(y, MARGIN), Math.max(maxY, MARGIN)),
    };
    el.style.transform = `translate3d(${pos.current.x}px, ${pos.current.y}px, 0)`;
  }

  // Initial placement (saved spot, else bottom-right) + keep on-screen when
  // the window shrinks.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const saved = loadPos();
    clampAndApply(
      saved?.x ?? window.innerWidth - el.offsetWidth - 16,
      saved?.y ?? window.innerHeight - el.offsetHeight - 16,
    );
    const onResize = () => clampAndApply(pos.current.x, pos.current.y);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return; // buttons stay clickable
    e.preventDefault();
    ref.current?.setPointerCapture(e.pointerId);
    grab.current = { dx: e.clientX - pos.current.x, dy: e.clientY - pos.current.y };
    setDragging(true);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!ref.current?.hasPointerCapture(e.pointerId)) return;
    latest.current = { x: e.clientX, y: e.clientY };
    // Coalesce moves into one write per frame.
    if (!rafId.current) {
      rafId.current = requestAnimationFrame(() => {
        rafId.current = 0;
        clampAndApply(latest.current.x - grab.current.dx, latest.current.y - grab.current.dy);
      });
    }
  }

  function onPointerEnd(e: React.PointerEvent) {
    if (!ref.current?.hasPointerCapture(e.pointerId)) return;
    ref.current.releasePointerCapture(e.pointerId);
    setDragging(false);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pos.current));
    } catch {
      /* private mode etc. — position just won't persist */
    }
  }

  return (
    <div
      ref={ref}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      className={`fixed left-0 top-0 z-30 w-72 touch-none select-none will-change-transform ${
        dragging ? "cursor-grabbing" : "cursor-grab"
      }`}
    >
      <div
        className={`rounded-2xl border border-white/10 bg-white/5 p-2 backdrop-blur-[12px] transition-[box-shadow,scale] duration-150 ${
          dragging ? "scale-[1.02] shadow-2xl shadow-black/50" : "shadow-lg shadow-black/30"
        }`}
      >
        <div className="mb-1.5 flex items-center gap-2 px-1">
          <button
            onClick={() => setFlipped((f) => !f)}
            aria-pressed={flipped}
            className="rounded-md border border-line px-1.5 py-0.5 text-muted transition-colors hover:border-aura/40 hover:text-aura"
            title={flipped ? "Back to the camera" : "Show everyone in the room"}
          >
            {flipped ? <Video className="h-3.5 w-3.5" /> : <Users className="h-3.5 w-3.5" />}
          </button>
          <span className="text-[11px] uppercase tracking-widest text-muted">
            {flipped ? "in this room" : "camera · gestures"}
          </span>
          {!flipped && (
            <button
              onClick={() => setEnabled(!enabled)}
              className={`ml-auto rounded-md border px-2 py-0.5 font-mono text-[11px] transition-colors ${
                enabled
                  ? "border-aura/40 text-aura hover:bg-aura/10"
                  : "border-line text-muted hover:text-ink50"
              }`}
              title={enabled ? "Turn camera off" : "Turn camera on"}
            >
              {enabled ? "on" : "off"}
            </button>
          )}
          <span aria-hidden className="ml-auto font-mono text-xs tracking-widest text-muted">
            ⠿
          </span>
        </div>

        {/* Both faces stay mounted; the camera is hidden rather than unmounted
            so flipping never restarts getUserMedia or the landmarker. */}
        <div className="relative">
          <div className={flipped ? "invisible" : undefined} aria-hidden={flipped}>
            <WebcamFeed onGesture={onGesture} />
          </div>
          {flipped && (
            <div className="absolute inset-0 overflow-y-auto rounded-xl border border-line bg-surface/80 p-2.5">
              <MemberList />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
