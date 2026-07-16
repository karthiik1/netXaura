// Downloads the MediaPipe hand-landmarker model (~7.5 MB) into public/models/
// so gesture recognition works fully offline (§0 LAN assumption). Run once:
//
//     npm run fetch:models
//
// Without the local model the app still works — useGestureRecognition falls
// back to Google's CDN, which needs internet.
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const dest = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
  "models",
  "hand_landmarker.task",
);

if (existsSync(dest)) {
  console.log("model already present:", dest);
  process.exit(0);
}

mkdirSync(dirname(dest), { recursive: true });
console.log("downloading", MODEL_URL);
const res = await fetch(MODEL_URL);
if (!res.ok || !res.body) {
  console.error("download failed:", res.status, res.statusText);
  process.exit(1);
}
await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
console.log("saved", dest);
