import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { GridInteractionProvider } from "./components/GridInteractionProvider";
import { UndoProvider } from "./components/UndoProvider";
import { initializeTheme } from "./lib/theme";

const initialTheme = initializeTheme();

// Dev diagnostics panel (Ctrl+Shift+D). Mounted as a sibling of <App/> rather
// than inside it, so the app tree carries no reference to developer tooling and
// the panel still works when App itself is stuck on an error or loading state.
//
// This is the production cut-off: Vite replaces `import.meta.env.DEV` with the
// literal `false` in a release build, so the ternary folds to `null`, the
// `import()` call becomes unreachable, and Rollup emits no chunk for the
// dashboard at all. Verified by `pnpm check:prod-bundle`.
const DevDashboardHost = import.meta.env.DEV
  ? lazy(() => import("./components/dev/DevDashboardHost"))
  : null;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <GridInteractionProvider>
      <UndoProvider>
        <App initialTheme={initialTheme} />
      </UndoProvider>
    </GridInteractionProvider>
    {DevDashboardHost && (
      <Suspense fallback={null}>
        <DevDashboardHost />
      </Suspense>
    )}
  </React.StrictMode>,
);
