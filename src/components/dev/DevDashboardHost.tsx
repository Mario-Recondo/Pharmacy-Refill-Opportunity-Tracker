// Mount point for the dev dashboard: owns the open/closed state, the keyboard
// shortcut and the launcher tab, so DevDashboard itself stays a pure view.
//
// Like DevDashboard, this module is only ever reached through App.tsx's
// `import.meta.env.DEV` guarded dynamic import, so it does not exist in a
// release build.

import { useEffect, useState } from "react";
import DevDashboard from "./DevDashboard";

/** Ctrl+Shift+D. Chosen to avoid the app's existing shortcuts: Ctrl+Z is undo
 *  (UndoProvider) and Enter/Tab/Escape belong to the grid editors. */
function isToggleChord(e: KeyboardEvent): boolean {
  return e.ctrlKey && e.shiftKey && (e.key === "D" || e.key === "d");
}

export default function DevDashboardHost() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isToggleChord(e)) return;
      e.preventDefault();
      setOpen((wasOpen) => !wasOpen);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!open) {
    return (
      <button className="devdash-launcher" onClick={() => setOpen(true)} title="Diagnostics (Ctrl+Shift+D)">
        ⌁ diag
      </button>
    );
  }
  return <DevDashboard onClose={() => setOpen(false)} />;
}
