import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { maybeRunIpcBench } from "./ipcBench";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

void maybeRunIpcBench();
