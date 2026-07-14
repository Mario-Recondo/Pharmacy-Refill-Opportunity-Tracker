import { ask } from "@tauri-apps/plugin-dialog";

/**
 * Native OS confirmation for destructive/consequential actions. Replaces
 * window.confirm, which proved unreliable in the shipped webview (2026-07-14:
 * a plan was deleted with no visible warning). The native dialog carries a
 * warning icon, an explicit action button label, and cannot be suppressed by
 * webview quirks. Cancel is always the safe default reading.
 */
export function confirmDestructive(
  message: string,
  opts?: { title?: string; action?: string },
): Promise<boolean> {
  return ask(message, {
    title: opts?.title ?? "Are you sure?",
    kind: "warning",
    okLabel: opts?.action ?? "Yes",
    cancelLabel: "Cancel",
  });
}
