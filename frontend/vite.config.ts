/// <reference types="vitest/config" />
import { cp } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// The package's exports map hides package.json, so resolve the main bundle
// (which sits at the package root) and take its directory.
const require = createRequire(import.meta.url);
const wasmDir = join(dirname(require.resolve("@mediapipe/tasks-vision")), "wasm");

// Serve the MediaPipe WASM runtime from node_modules at /mediapipe/wasm so the
// app works on a LAN with no internet (§0). In dev it's an alias into
// node_modules; for builds the files are copied into dist. The model file is
// separate — see scripts/fetch-models.mjs.
function mediapipeWasm(): Plugin {
  return {
    name: "netxaura:mediapipe-wasm",
    configureServer(server) {
      server.middlewares.use("/mediapipe/wasm", (req, res, next) => {
        const file = (req.url ?? "/").split("?")[0].replace(/^\//, "");
        if (!file) return next();
        res.setHeader(
          "Content-Type",
          file.endsWith(".js") ? "text/javascript" : "application/wasm",
        );
        import("node:fs")
          .then((fs) => {
            const stream = fs.createReadStream(join(wasmDir, file));
            stream.on("error", () => {
              res.statusCode = 404;
              res.end();
            });
            stream.pipe(res);
          })
          .catch(next);
      });
    },
    async closeBundle() {
      await cp(wasmDir, join(__dirname, "dist", "mediapipe", "wasm"), {
        recursive: true,
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), mediapipeWasm()],
  server: { port: 5173, host: true },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
  },
});
