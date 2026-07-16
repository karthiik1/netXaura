// Webcam preview + gesture pipeline host. Runs the recognition hook and forwards
// discrete gestures to the workspace action layer. Fully optional — the app is
// usable via buttons if the camera is denied (§0, §6.1).
import { useRef } from "react";

import { useGestureStore } from "../../stores/gestureStore";
import { type GestureEvent, useGestureRecognition } from "./useGestureRecognition";
import { GestureStatusIndicator } from "./GestureStatusIndicator";

export function WebcamFeed({ onGesture }: { onGesture: (e: GestureEvent) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const enabled = useGestureStore((s) => s.enabled);

  // A denied/busy camera is not surfaced in the panel: the app stays fully
  // usable on the keys, and the hook keeps re-asking on its own (permission
  // flip + window focus), so the feed lights up if access is granted later.
  useGestureRecognition(videoRef, { enabled, onGesture });

  return (
    <div className="relative overflow-hidden rounded-xl border border-line bg-black/40">
      <video
        ref={videoRef}
        muted
        playsInline
        className="aspect-video w-full -scale-x-100 object-cover"
      />
      {!enabled && (
        <div className="absolute inset-0 grid place-items-center text-center text-xs text-muted">
          camera off — turn on gestures, or use the S / T / W keys
        </div>
      )}
      <div className="absolute bottom-2 left-2 right-2">
        <GestureStatusIndicator />
      </div>
    </div>
  );
}
