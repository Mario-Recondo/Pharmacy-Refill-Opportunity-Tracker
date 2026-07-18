import { getVersion } from "@tauri-apps/api/app";
import { ask, message } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

async function promptAndInstall(update: Update): Promise<void> {
  const install = await ask(
    `Refill Tracker ${update.version} is available (you have ${update.currentVersion}).\nInstall it now? The app will restart.`,
    {
      title: "Update available",
      okLabel: "Install and restart",
      cancelLabel: "Not now",
      kind: "info",
    },
  );
  if (!install) return;
  await update.downloadAndInstall();
  await relaunch();
}

export async function checkForUpdateOnLaunch(): Promise<void> {
  if (import.meta.env.DEV) return;
  try {
    const update = await check();
    if (update) await promptAndInstall(update);
  } catch (e) {
    console.warn("update check failed", e);
  }
}

export async function checkForUpdateManual(): Promise<void> {
  try {
    const update = await check();
    if (update) {
      await promptAndInstall(update);
      return;
    }
    const currentVersion = await getVersion();
    await message(`You're on the latest version (v${currentVersion}).`, { title: "Refill Tracker" });
  } catch (e) {
    await message(`Could not check for updates.\n${String(e)}`, {
      title: "Refill Tracker",
      kind: "warning",
    });
  }
}
