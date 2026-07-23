import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { GridInteractionProvider } from "./components/GridInteractionProvider";
import { initializeTheme } from "./lib/theme";

const initialTheme = initializeTheme();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <GridInteractionProvider>
      <App initialTheme={initialTheme} />
    </GridInteractionProvider>
  </React.StrictMode>,
);
