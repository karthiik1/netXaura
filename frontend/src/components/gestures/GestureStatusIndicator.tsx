// Live read-out of the classifier (§6.6): current gesture, hand count, and a
// confidence bar so users can see why a gesture did / didn't fire.
import { useGestureStore } from "../../stores/gestureStore";

const LABEL: Record<string, string> = {
  none: "—",
  point: "pointing",
  ok: "OK · tab",
  open_palm: "open palm",
  fist: "fist",
  two_fingers: "two fingers · copy tab",
  two_hands_open: "both palms · all tabs",
  two_hands_fist: "both fists · send all",
};

export function GestureStatusIndicator() {
  const { currentGesture, confidence, handCount } = useGestureStore();
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-surface/85 px-2.5 py-1.5 backdrop-blur">
      <span className="font-mono text-[11px] text-muted">{handCount}✋</span>
      <span className="min-w-16 font-mono text-xs text-aura">{LABEL[currentGesture]}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
        <div
          className="h-full bg-aura transition-[width] duration-100"
          style={{ width: `${Math.round(confidence * 100)}%` }}
        />
      </div>
    </div>
  );
}
