import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import "./index.css";
import { useTransferStore } from "./stores/transferStore";
import { useWorkspaceStore } from "./stores/workspaceStore";
import { useGestureStore } from "./stores/gestureStore";

// Dev-only: expose the stores for console debugging (never in prod builds).
if (import.meta.env.DEV) {
  Object.assign(window, {
    __nx: { transfer: useTransferStore, workspace: useWorkspaceStore, gesture: useGestureStore },
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
