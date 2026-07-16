# gesture-service (reserved — not built in V1)

V1 runs hand-landmark detection **entirely in the browser** via
`@mediapipe/tasks-vision` (see `frontend/src/components/gestures/`). No video
ever leaves the client; only recognized gesture events do, and only as
telemetry.

This directory is a placeholder for a **future, optional** Python microservice
that would offload MediaPipe detection from low-power clients. It is intentionally
empty in V1 — there is no package to build here. See §6 of the build spec.
