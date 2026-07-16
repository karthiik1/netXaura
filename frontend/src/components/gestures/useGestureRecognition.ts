// useGestureRecognition (§6): in-browser MediaPipe HandLandmarker + geometric
// classification. Only recognized gesture events leave this module (telemetry)
// and drive the same actions the buttons drive — never raw video (§0).
//
// All thresholds are documented inline and tunable. Distances are normalized by
// hand size (wrist -> middle-finger MCP) so they're invariant to how near/far
// the user is from the camera (§6.3).
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import { useCallback, useEffect, useRef, useState } from "react";

import { remapCursor } from "../../lib/cursorMap";
import { OneEuroPoint2D } from "../../lib/oneEuro";
import { type GestureName, useGestureStore } from "../../stores/gestureStore";

// Local-first assets (§0 LAN assumption): the WASM runtime is always served
// from the app itself (vite copies it out of node_modules), and the model is
// local when `npm run fetch:models` has been run — otherwise CDN fallback.
const LOCAL_WASM = "/mediapipe/wasm";
const LOCAL_MODEL = "/models/hand_landmarker.task";
const CDN_MODEL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

async function resolveModelPath(): Promise<string> {
  try {
    const head = await fetch(LOCAL_MODEL, { method: "HEAD" });
    if (head.ok) return LOCAL_MODEL;
  } catch {
    /* fall through to CDN */
  }
  return CDN_MODEL;
}

type Point = { x: number; y: number; z: number };
type Hand = Point[];

// --- landmark indices (MediaPipe Hands topology) ---------------------------
const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_MCP = 5;
const INDEX_PIP = 6;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;
const MIDDLE_TIP = 12;
const RING_TIP = 16;
const PINKY_TIP = 20;
const FINGER_PIP = { [INDEX_TIP]: INDEX_PIP, [MIDDLE_TIP]: 10, [RING_TIP]: 14, [PINKY_TIP]: 18 };

// --- air-cursor mapping (§6.3) ---------------------------------------------
// The cursor anchors on the index KNUCKLE (MCP), not the fingertip: the knuckle
// barely moves when the finger curls, so the cursor stays put when you close a
// fist to start an op-4 drag (the fingertip would leap toward the palm). It
// also jitters less than the tip.
const CURSOR_ANCHOR = INDEX_MCP;

// --- tunable thresholds ----------------------------------------------------
const PINCH_ON = 0.4; // normalized thumb-index distance below this = thumb+index touching
const EXTEND_MARGIN = 1.15; // tip must be >1.15x farther from wrist than its PIP
// A fist and a thumb-to-index touch both bring those tips together; they differ
// in HOW FOLDED the index is. In a fist the index tip folds all the way back to
// its own knuckle (MCP); when it merely reaches forward to meet the thumb its
// tip stays much farther from the knuckle. This ratio (tip↔MCP over hand size)
// separates them robustly regardless of hand orientation.
const FIST_FOLD_MAX = 0.6; // index tip↔MCP / hand-size below this = a real fist

function dist(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function handSize(h: Hand) {
  // Reference length used to normalize all other distances.
  return dist(h[WRIST], h[MIDDLE_MCP]) || 1e-6;
}

function isExtended(h: Hand, tip: number) {
  const pip = FINGER_PIP[tip as keyof typeof FINGER_PIP];
  return dist(h[tip], h[WRIST]) > dist(h[pip], h[WRIST]) * EXTEND_MARGIN;
}

function pinchDistance(h: Hand) {
  return dist(h[THUMB_TIP], h[INDEX_TIP]) / handSize(h);
}

interface Classified {
  gesture: GestureName;
  confidence: number;
}

// Heuristic poses fire at MediaPipe's presence score once matched — a matched
// pose is a deliberate act, and graded sub-scores used to sit below the firing
// threshold and silently drop clean gestures (§6.4).
function classifyOneHand(h: Hand, presence: number): Classified {
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

function bothOpen(hands: Hand[]) {
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

function bothFist(hands: Hand[]) {
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

export interface GestureEvent {
  gesture: GestureName;
  handsCount: number;
  confidence: number;
}

interface Options {
  enabled: boolean;
  cooldownMs?: number;
  confidenceThreshold?: number;
  onGesture?: (e: GestureEvent) => void;
}

export function useGestureRecognition(
  videoRef: React.RefObject<HTMLVideoElement>,
  { enabled, cooldownMs = 800, confidenceThreshold = 0.7, onGesture }: Options,
) {
  const update = useGestureStore((s) => s.update);
  const setPermission = useGestureStore((s) => s.setPermission);

  // Bumping this re-runs the whole init effect — a fresh getUserMedia ask.
  const [attempt, setAttempt] = useState(0);
  const permStatus = useRef<PermissionStatus | null>(null);
  const removeFocusRetry = useRef<(() => void) | null>(null);

  const raf = useRef<number>();
  const landmarker = useRef<HandLandmarker | null>(null);
  const lastFireAt = useRef(0);
  const lastVideoTime = useRef(-1);
  // Adaptive smoothing so the air cursor doesn't jitter while hovering (§6.3).
  // Lower minCutoff than the default kills more hover jitter (steady enough to
  // land on a word for an op-4 selection); the speed term keeps fast sweeps
  // responsive, and it operates in screen space (after the box remap below).
  const cursorFilter = useRef(new OneEuroPoint2D({ minCutoff: 0.7, beta: 5 }));

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    async function init() {
      const fileset = await FilesetResolver.forVisionTasks(LOCAL_WASM);
      landmarker.current = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: await resolveModelPath(),
          delegate: "GPU", // WASM+GPU; falls back to CPU automatically
        },
        numHands: 2,
        runningMode: "VIDEO",
      });

      const stream = await navigator.mediaDevices
        .getUserMedia({ video: { width: 640, height: 480 } })
        .catch((e: unknown) => (e instanceof DOMException ? e : null));
      if (!(stream instanceof MediaStream)) {
        // NotReadable/Abort = the OS wouldn't release the device (another
        // app or browser holds the webcam); everything else = a denial.
        const busy =
          stream !== null && (stream.name === "NotReadableError" || stream.name === "AbortError");
        setPermission(busy ? "busy" : "denied");
        watchPermission();
        retryOnFocus();
        return;
      }
      setPermission("granted");
      const video = videoRef.current;
      if (!video || cancelled) return;
      video.srcObject = stream;
      await video.play().catch(() => {});
      loop();
    }

    function loop() {
      raf.current = requestAnimationFrame(loop);
      const video = videoRef.current;
      const lm = landmarker.current;
      if (!video || !lm || video.readyState < 2) return;
      if (video.currentTime === lastVideoTime.current) return; // throttle to frame rate
      lastVideoTime.current = video.currentTime;

      const result = lm.detectForVideo(video, performance.now());
      const hands = (result.landmarks ?? []) as Hand[];
      const presence = result.handedness?.[0]?.[0]?.score ?? 1;

      // Air cursor tracks the index knuckle of the first hand (mirror x — the
      // feed is mirrored so it follows the user's real-world hand, §6): remap
      // the comfortable box to the full screen, then One-Euro smooth. Anchoring
      // on the knuckle (not the tip) means closing a fist to start a drag
      // doesn't jump the cursor (§op 4).
      let cursor: { x: number; y: number } | null = null;
      if (hands[0]) {
        const a = hands[0][CURSOR_ANCHOR];
        cursor = cursorFilter.current.filter(
          remapCursor(1 - a.x, a.y),
          performance.now(),
        );
      } else {
        cursorFilter.current.reset();
      }

      let gesture: GestureName = "none";
      let confidence = 0;

      if (hands.length === 2) {
        // Operation 2: both palms open and both fists are two distinct discrete
        // gestures — the arm/confirm ordering (open then fist) is sequenced in
        // WorkspaceLayout, exactly like Op 1's one-handed palm→fist.
        if (bothOpen(hands)) {
          gesture = "two_hands_open";
          confidence = presence;
        } else if (bothFist(hands)) {
          gesture = "two_hands_fist";
          confidence = presence;
        }
      } else if (hands.length === 1) {
        const c = classifyOneHand(hands[0], presence);
        gesture = c.gesture;
        confidence = c.confidence;
      }

      update({ currentGesture: gesture, confidence, handCount: hands.length, cursor });

      // Fire discrete gestures past the confidence gate and cooldown. "point"
      // (cursor movement) is a continuous pose — it must not consume the
      // cooldown, or holding it would swallow the gesture that follows.
      const now = performance.now();
      const discrete = gesture !== "none" && gesture !== "point";
      if (
        discrete &&
        confidence >= confidenceThreshold &&
        now - lastFireAt.current > cooldownMs
      ) {
        lastFireAt.current = now;
        onGesture?.({ gesture, handsCount: hands.length, confidence });
      }
    }

    // A busy camera frees up when the other app closes — which the user does
    // in another window, then comes back here. One re-ask per failed attempt
    // when this window regains focus (harmless when still denied: the browser
    // rejects instantly without re-prompting).
    function retryOnFocus() {
      const onFocus = () => setAttempt((a) => a + 1);
      window.addEventListener("focus", onFocus, { once: true });
      removeFocusRetry.current = () => window.removeEventListener("focus", onFocus);
    }

    // A denied getUserMedia is not final: the user often flips the browser's
    // camera permission afterwards. Watch for that flip and re-ask instead of
    // staying stuck on "denied" until a reload.
    async function watchPermission() {
      try {
        const status = await navigator.permissions.query({ name: "camera" as PermissionName });
        if (cancelled) return;
        permStatus.current = status;
        status.onchange = () => {
          if (status.state === "granted") setAttempt((a) => a + 1);
        };
      } catch {
        /* camera isn't queryable in this browser — the panel's retry button covers it */
      }
    }

    init();
    return () => {
      cancelled = true;
      if (raf.current) cancelAnimationFrame(raf.current);
      if (permStatus.current) {
        permStatus.current.onchange = null;
        permStatus.current = null;
      }
      removeFocusRetry.current?.();
      removeFocusRetry.current = null;
      const stream = videoRef.current?.srcObject as MediaStream | null;
      stream?.getTracks().forEach((t) => t.stop());
      landmarker.current?.close();
      landmarker.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, attempt, cooldownMs, confidenceThreshold]);

  // Manual re-ask for the "camera blocked" overlay's try-again button.
  return { retry: useCallback(() => setAttempt((a) => a + 1), []) };
}
