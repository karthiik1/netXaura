// Screen-space air cursor driven by the index-tip landmark (§6). Rendered only
// while pointing so it doesn't distract during typing.
import { useGestureStore } from "../../stores/gestureStore";

export function AirCursor() {
  const cursor = useGestureStore((s) => s.cursor);
  const gesture = useGestureStore((s) => s.currentGesture);
  if (!cursor || gesture === "none") return null;
  return (
    <div
      className="pointer-events-none fixed z-40 -translate-x-1/2 -translate-y-1/2"
      style={{
        left: `${cursor.x * 100}vw`,
        top: `${cursor.y * 100}vh`,
        // The gesture pipeline updates at camera frame rate (~30fps); a short
        // linear transition glides the dot between samples so it reads smooth
        // instead of stepping. Short enough not to feel laggy on fast sweeps.
        transition: "left 55ms linear, top 55ms linear",
      }}
    >
      <div className="grid h-6 w-6 place-items-center rounded-full border-2 border-aura bg-aura/20 transition-[transform,background-color,border-color] duration-100">
        {/* Precise aim point at the exact cursor position. */}
        <span className="h-1 w-1 rounded-full bg-white/90" />
      </div>
    </div>
  );
}
