import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./index.css";
import App from "./App.tsx";
import { isAndroid } from "./lib/platform";

document.documentElement.dataset.platform = isAndroid ? "android" : "desktop";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
