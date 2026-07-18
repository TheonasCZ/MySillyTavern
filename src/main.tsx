import React from "react";
import ReactDOM from "react-dom/client";

import "./index.css";
import "./i18n";
import App from "./App";
import { initErrorLogging, refreshLogLevel } from "./logging";

initErrorLogging();
void refreshLogLevel();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
