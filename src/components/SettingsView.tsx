// Settings tab (M5, stories 4.1-4.3): left sidebar of seven sections. All edits
// persist immediately and call onChanged -> App reloads the lookup bundle
// app-wide (design doc §6.6). Vocabulary CRUD: inline rename, up/down reorder,
// kebab menu for move/designations/logo/deactivate/delete-when-unused.

import { useCallback, useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  addInsuranceGroup,
  addLookup,
  backupDatabase,
  databasePath,
  deleteGroupIfEmpty,
  deleteLookupIfUnused,
  lookupUsageCount,
  groupPlanCount,
  recolorLookup,
  renameLookup,
  restoreDatabase,
  saveCopayTiers,
  saveSetting,
  setGroupLogo,
  setInsuranceGroup,
  setLookupActive,
  setLookupFlag,
  setSecondaryLogo,
  splitActive,
  swapSortOrder,
  validateBackupFile,
  type LookupTable,
} from "../data/settingsData";
import type { CopayTier, InsuranceGroup, Lookup, Lookups } from "../data/types";
import { confirmDestructive } from "../lib/confirmDialog";
import { LOGO_ASSETS, logoUrl } from "../lib/logoAssets";
import { designationSuffix } from "../lib/rules";
import { textColorFor } from "../lib/colors";
import { checkForUpdateManual } from "../lib/updater";

interface SettingsProps {
  lookups: Lookups;
  /** every successful write reports here → App re-fetches the whole bundle */
  onChanged: () => void;
}

interface SettingsViewProps extends SettingsProps {
  darkMode: boolean;
  onDarkModeChange: (darkMode: boolean) => boolean;
}

type SectionKey = "insurances" | "secondary" | "refillNotes" | "callNotes" | "thresholds" | "backup" | "about";

const SECTIONS: { key: SectionKey; label: string }[] = [
  { key: "insurances", label: "Insurances" },
  { key: "secondary", label: "Secondary coverages" },
  { key: "refillNotes", label: "Refill notes" },
  { key: "callNotes", label: "Call notes" },
  { key: "thresholds", label: "Thresholds" },
  { key: "backup", label: "Backup & restore" },
  { key: "about", label: "About" },
];

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

/** Click-to-edit name. Commit on Enter/blur, Esc cancels, empty reverts. */
function InlineName({ value, suffix, onCommit }: { value: string; suffix?: string; onCommit: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setText(value);
  }
  if (!editing) {
    return (
      <span className="s-name" title="Click to rename" onClick={() => setEditing(true)}>
        {value}
        {suffix && <span className="s-suffix">{suffix}</span>}
      </span>
    );
  }
  const commit = () => {
    setEditing(false);
    const t = text.trim();
    if (t && t !== value) onCommit(t);
    else setText(value);
  };
  return (
    <input
      className="s-name-input"
      autoFocus
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") {
          setText(value);
          setEditing(false);
        }
      }}
    />
  );
}

interface MenuItem {
  label: string;
  onClick?: () => void;
  submenu?: MenuItem[];
  checked?: boolean;
  danger?: boolean;
  disabled?: boolean;
}

/** Kebab (⋯) menu. Items may load async (usage counts decide whether Delete shows). */
function Kebab({ buildItems }: { buildItems: () => Promise<MenuItem[]> }) {
  const [items, setItems] = useState<MenuItem[] | null>(null);
  const [stack, setStack] = useState<MenuItem[][]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const openMenu = async () => setItems(items ? null : await buildItems());
  const close = useCallback(() => {
    setItems(null);
    setStack([]);
  }, []);

  useEffect(() => {
    if (!items) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [items, close]);

  const current = stack.length ? stack[stack.length - 1] : items;
  return (
    <div className="s-kebab" ref={rootRef}>
      <button className="s-kebab-btn" title="More actions" onClick={openMenu}>
        ⋯
      </button>
      {current && (
        <div className="s-menu">
          {stack.length > 0 && (
            <button className="s-menu-item" onClick={() => setStack(stack.slice(0, -1))}>
              ← Back
            </button>
          )}
          {current.map((it, i) => (
            <button
              key={i}
              className={`s-menu-item${it.danger ? " danger" : ""}`}
              disabled={it.disabled}
              onClick={() => {
                if (it.submenu) setStack([...stack, it.submenu]);
                else {
                  close();
                  it.onClick?.();
                }
              }}
            >
              {/* constant gutter keeps labels aligned whether or not a row is checkable */}
              <span className="s-check">{it.checked ? "✓" : ""}</span>
              {it.label}
              {it.submenu && " …"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function UpDown({ onUp, onDown, canUp, canDown }: { onUp: () => void; onDown: () => void; canUp: boolean; canDown: boolean }) {
  return (
    <span className="s-updown">
      <button title="Move up" disabled={!canUp} onClick={onUp}>
        ▲
      </button>
      <button title="Move down" disabled={!canDown} onClick={onDown}>
        ▼
      </button>
    </span>
  );
}

function AddRow({ placeholder, onAdd }: { placeholder: string; onAdd: (name: string) => void }) {
  const [text, setText] = useState("");
  const submit = () => {
    const t = text.trim();
    if (!t) return;
    onAdd(t);
    setText("");
  };
  return (
    <div className="s-add">
      <input
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
      />
      <button disabled={!text.trim()} onClick={submit}>
        Add
      </button>
    </div>
  );
}

/** Shared kebab items: deactivate/reactivate + delete-when-unused (grill decision Q7). */
async function lifecycleItems(
  table: LookupTable,
  row: Lookup,
  what: string,
  onChanged: () => void,
): Promise<MenuItem[]> {
  const used = await lookupUsageCount(table, row.id);
  const items: MenuItem[] = [
    {
      label: row.active === 1 ? "Deactivate" : "Reactivate",
      onClick: async () => {
        await setLookupActive(table, row.id, row.active !== 1);
        onChanged();
      },
    },
  ];
  if (used === 0) {
    items.push({
      label: "Delete…",
      danger: true,
      onClick: async () => {
        const ok = await confirmDestructive(
          `Delete ${what} "${row.name}"?\n\nNothing references it, and this cannot be undone.`,
          { title: `Delete ${what}`, action: "Delete" },
        );
        if (!ok) return;
        if (!(await deleteLookupIfUnused(table, row.id))) {
          alert("It's now in use — deactivate it instead.");
        }
        onChanged();
      },
    });
  }
  return items;
}

function logoPickerItems(current: string | null | undefined, apply: (key: string | null) => void): MenuItem[] {
  return [
    { label: "No logo", checked: !current, onClick: () => apply(null) },
    ...Object.entries(LOGO_ASSETS).map(([key, a]) => ({
      label: a.label,
      checked: current === key,
      onClick: () => apply(key),
    })),
  ];
}

// ---------------------------------------------------------------------------
// Insurances: plans grouped under brand groups, Ungrouped at the bottom
// ---------------------------------------------------------------------------

function InsuranceSection({ lookups, onChanged }: SettingsProps) {
  const groups = lookups.insuranceGroups;
  const wrap = (p: Promise<unknown>) => p.then(onChanged).catch((e) => alert(`Save failed.\n${e}`));

  const planRow = (plan: Lookup, siblings: Lookup[], idx: number) => (
    <div key={plan.id} className={`s-row${plan.active !== 1 ? " off" : ""}`}>
      <UpDown
        canUp={idx > 0}
        canDown={idx < siblings.length - 1}
        onUp={() => wrap(swapSortOrder("insurances", plan, siblings[idx - 1]))}
        onDown={() => wrap(swapSortOrder("insurances", plan, siblings[idx + 1]))}
      />
      <InlineName
        value={plan.name}
        suffix={designationSuffix(plan) || undefined}
        onCommit={(v) => wrap(renameLookup("insurances", plan.id, v))}
      />
      <Kebab
        buildItems={async () => [
          {
            label: "Move to group",
            submenu: [
              {
                label: "Ungrouped",
                checked: plan.group_id == null,
                onClick: () => wrap(setInsuranceGroup(plan.id, null)),
              },
              ...groups
                .filter((g) => g.active === 1)
                .map((g) => ({
                  label: g.name,
                  checked: plan.group_id === g.id,
                  onClick: () => wrap(setInsuranceGroup(plan.id, g.id)),
                })),
            ],
          },
          {
            label: "Medicare",
            checked: plan.is_medicare === 1,
            onClick: () => wrap(setLookupFlag("insurances", plan.id, "is_medicare", plan.is_medicare !== 1)),
          },
          {
            label: "Medicaid",
            checked: plan.is_medicaid === 1,
            onClick: () => wrap(setLookupFlag("insurances", plan.id, "is_medicaid", plan.is_medicaid !== 1)),
          },
          ...(await lifecycleItems("insurances", plan, "insurance", onChanged)),
        ]}
      />
    </div>
  );

  const renderGroup = (group: InsuranceGroup | null, gIdx: number) => {
    const plans = lookups.insurances.filter((i) => (group ? i.group_id === group.id : i.group_id == null));
    const url = group ? logoUrl(group.logo) : undefined;
    return (
      <div key={group?.id ?? "ungrouped"} className="s-group">
        <div className="s-group-head">
          {group ? (
            <>
              <UpDown
                canUp={gIdx > 0}
                canDown={gIdx < groups.length - 1}
                onUp={() => wrap(swapSortOrder("insurance_groups", group, groups[gIdx - 1]))}
                onDown={() => wrap(swapSortOrder("insurance_groups", group, groups[gIdx + 1]))}
              />
              <InlineName value={group.name} onCommit={(v) => wrap(renameLookup("insurance_groups", group.id, v))} />
              {url ? <img className="s-logo" src={url} alt="" /> : <span className="s-nologo">no logo</span>}
              <Kebab
                buildItems={async () => {
                  const count = await groupPlanCount(group.id);
                  const items: MenuItem[] = [
                    { label: "Pick logo", submenu: logoPickerItems(group.logo, (k) => wrap(setGroupLogo(group.id, k))) },
                  ];
                  if (count === 0 && group.is_default !== 1) {
                    items.push({
                      label: "Delete…",
                      danger: true,
                      onClick: async () => {
                        const ok = await confirmDestructive(`Delete the empty group "${group.name}"?`, {
                          title: "Delete group",
                          action: "Delete",
                        });
                        if (!ok) return;
                        if (!(await deleteGroupIfEmpty(group.id))) alert("The group has plans now — move them first.");
                        onChanged();
                      },
                    });
                  }
                  return items;
                }}
              />
            </>
          ) : (
            <span className="s-group-title">Ungrouped</span>
          )}
        </div>
        {plans.map((p, i) => planRow(p, plans, i))}
        {plans.length === 0 && <div className="s-empty">no plans</div>}
      </div>
    );
  };

  return (
    <div>
      <p className="s-hint">
        Plans show their group's logo in the grid — or plain text when the group has no logo or the plan is ungrouped.
        Medicare/Medicaid are designations on the plan, set from its ⋯ menu.
      </p>
      {groups.map((g, i) => renderGroup(g, i))}
      {renderGroup(null, -1)}
      <AddRow placeholder="New insurance (lands in Ungrouped)…" onAdd={(n) => wrap(addLookup("insurances", n))} />
      <AddRow placeholder="New brand group…" onAdd={(n) => wrap(addInsuranceGroup(n))} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Flat lookup sections (secondary coverages, refill notes, call notes)
// ---------------------------------------------------------------------------

function FlatSection({
  onChanged,
  table,
  rows,
  what,
  withColor,
  withLogo,
  withNoteFlags,
  withFollowupFlag,
}: Omit<SettingsProps, "lookups"> & {
  table: LookupTable;
  rows: Lookup[];
  what: string;
  withColor?: boolean;
  withLogo?: boolean;
  withNoteFlags?: boolean;
  withFollowupFlag?: boolean;
}) {
  const wrap = (p: Promise<unknown>) => p.then(onChanged).catch((e) => alert(`Save failed.\n${e}`));
  const { active, inactive } = splitActive(rows);

  const row = (r: Lookup, siblings: Lookup[], idx: number) => (
    <div key={r.id} className={`s-row${r.active !== 1 ? " off" : ""}`}>
      <UpDown
        canUp={idx > 0}
        canDown={idx < siblings.length - 1}
        onUp={() => wrap(swapSortOrder(table, r, siblings[idx - 1]))}
        onDown={() => wrap(swapSortOrder(table, r, siblings[idx + 1]))}
      />
      {withColor && (
        <input
          type="color"
          className="s-swatch"
          value={r.color ?? "#eeeeee"}
          title="Recolor"
          onChange={(e) => wrap(recolorLookup(table as "refill_notes" | "call_notes", r.id, e.target.value))}
        />
      )}
      <InlineName value={r.name} onCommit={(v) => wrap(renameLookup(table, r.id, v))} />
      {withLogo && (r.logo ? <img className="s-logo" src={logoUrl(r.logo)} alt="" /> : <span className="s-nologo">no logo</span>)}
      {withNoteFlags && (
        <span className="s-flags">
          <label title="When this note is set, the row's Call Note cell is enabled">
            <input
              type="checkbox"
              checked={r.allows_call_note === 1}
              onChange={(e) => wrap(setLookupFlag(table, r.id, "allows_call_note", e.target.checked))}
            />
            call note
          </label>
          <label title="Month grid shows a days-since-set counter on this note">
            <input
              type="checkbox"
              checked={r.shows_age_counter === 1}
              onChange={(e) => wrap(setLookupFlag(table, r.id, "shows_age_counter", e.target.checked))}
            />
            day counter
          </label>
        </span>
      )}
      {withFollowupFlag && (
        <span className="s-flags">
          <label title="Rows with this call note surface on the Req Follow Up tab once the patient stays quiet past the wait threshold">
            <input
              type="checkbox"
              checked={r.requires_followup === 1}
              onChange={(e) => wrap(setLookupFlag(table, r.id, "requires_followup", e.target.checked))}
            />
            req follow-up
          </label>
        </span>
      )}
      <Kebab
        buildItems={async () => [
          ...(withLogo
            ? [{ label: "Pick logo", submenu: logoPickerItems(r.logo, (k) => wrap(setSecondaryLogo(r.id, k))) }]
            : []),
          ...(await lifecycleItems(table, r, what, onChanged)),
        ]}
      />
    </div>
  );

  return (
    <div>
      {active.map((r, i) => row(r, active, i))}
      {inactive.length > 0 && (
        <>
          <div className="s-divider">Deactivated — kept for historical rows, hidden from dropdowns</div>
          {inactive.map((r, i) => row(r, inactive, i))}
        </>
      )}
      <AddRow placeholder={`New ${what}…`} onAdd={(n) => wrap(addLookup(table, n))} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Thresholds (story 4.2): alert numbers + full copay tier editor
// ---------------------------------------------------------------------------

function NumberSetting({
  label,
  value,
  settingKey,
  onChanged,
  min = 0,
  prefix,
}: {
  label: string;
  value: number;
  settingKey: string;
  onChanged: () => void;
  min?: number;
  prefix?: string;
}) {
  const [text, setText] = useState(String(value));
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setText(String(value));
  }
  const commit = async () => {
    const n = Number(text);
    if (!Number.isFinite(n) || n < min) {
      setText(String(value));
      return;
    }
    if (n !== value) {
      await saveSetting(settingKey, String(n));
      onChanged();
    }
  };
  return (
    <label className="s-number">
      <span>{label}</span>
      <span className="s-number-box">
        {prefix}
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
      </span>
    </label>
  );
}

function ThresholdsSection({ lookups, onChanged }: SettingsProps) {
  const s = lookups.settings;
  const [tiers, setTiers] = useState<CopayTier[]>(s.copayTiers);
  const [seenTiers, setSeenTiers] = useState(s.copayTiers);
  const [invalid, setInvalid] = useState(false);
  if (s.copayTiers !== seenTiers) {
    setSeenTiers(s.copayTiers);
    setTiers(s.copayTiers);
    setInvalid(false);
  }

  /** boundaries must be strictly ascending (grill decision Q9) — invalid edits stay local and unsaved */
  const persistIfValid = async (next: CopayTier[]) => {
    setTiers(next);
    const bounded = next.filter((t) => t.max !== null).map((t) => t.max as number);
    const ascending = bounded.every((m, i) => i === 0 || m > bounded[i - 1]);
    setInvalid(!ascending);
    if (ascending) {
      await saveCopayTiers(next);
      onChanged();
    }
  };

  return (
    <div>
      <h3 className="s-sub">Opportunity alerts</h3>
      <NumberSetting label="Look-ahead window (days)" value={s.alertLookaheadDays} settingKey="alert_lookahead_days" onChanged={onChanged} />
      <NumberSetting label="Minimum last-verified profit" value={s.alertMinProfit} settingKey="alert_min_profit" onChanged={onChanged} prefix="$" />
      <NumberSetting label="Nimble Link aging alert (days)" value={s.nimbleLinkAlertDays} settingKey="nimble_link_alert_days" onChanged={onChanged} min={1} />
      <NumberSetting label="Req Follow Up wait (days quiet)" value={s.followupWaitDays} settingKey="followup_wait_days" onChanged={onChanged} min={1} />

      <h3 className="s-sub">Copay color tiers</h3>
      <p className="s-hint">Each tier colors copays up to its boundary; the last tier covers everything above.</p>
      {invalid && <p className="s-error">Boundaries must increase from tier to tier — fix the order to save.</p>}
      {tiers.map((tier, i) => (
        <div key={i} className="s-row">
          <input
            type="color"
            className="s-swatch"
            value={tier.color}
            onChange={(e) => persistIfValid(tiers.map((t, j) => (j === i ? { ...t, color: e.target.value } : t)))}
          />
          {tier.max === null ? (
            <span className="s-tier-label">above {tiers.length > 1 ? `$${tiers[tiers.length - 2].max ?? 0}` : "$0"}</span>
          ) : (
            <span className="s-tier-label">
              up to $
              <input
                className="s-tier-max"
                defaultValue={tier.max}
                key={`${i}-${tier.max}`}
                onBlur={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n) && n >= 0) {
                    persistIfValid(tiers.map((t, j) => (j === i ? { ...t, max: n } : t)));
                  } else {
                    e.target.value = String(tier.max);
                  }
                }}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              />
            </span>
          )}
          {tier.max !== null && (
            <button
              className="s-tier-remove"
              title="Remove tier"
              onClick={() => persistIfValid(tiers.filter((_, j) => j !== i))}
            >
              ✕
            </button>
          )}
          <span
            className="s-tier-preview"
            style={{ backgroundColor: tier.color, color: textColorFor(tier.color) }}
          >
            $12.34
          </span>
        </div>
      ))}
      <button
        className="s-add-tier"
        onClick={() => {
          const lastBounded = tiers.filter((t) => t.max !== null).map((t) => t.max as number).pop() ?? 0;
          const top = tiers.find((t) => t.max === null);
          const bounded = tiers.filter((t) => t.max !== null);
          persistIfValid([...bounded, { max: lastBounded + 50, color: "#cccccc" }, ...(top ? [top] : [])]);
        }}
      >
        Add tier
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Backup & restore (story 4.3)
// ---------------------------------------------------------------------------

function BackupSection({ lookups, onChanged }: SettingsProps) {
  const [dbPath, setDbPath] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const folder = lookups.settings.backupFolder;

  useEffect(() => {
    databasePath().then(setDbPath).catch(console.error);
  }, []);

  const pickFolder = async (): Promise<string | null> => {
    const chosen = await openDialog({ directory: true, title: "Choose the backup folder" });
    if (typeof chosen !== "string") return null;
    await saveSetting("backup_folder", chosen);
    onChanged();
    return chosen;
  };

  const backupNow = async () => {
    try {
      setBusy("backup");
      const target = folder ?? (await pickFolder());
      if (!target) return;
      const file = await backupDatabase(target);
      setLastBackup(file);
    } catch (e) {
      alert(`Backup failed.\n${e}`);
    } finally {
      setBusy(null);
    }
  };

  const restore = async () => {
    try {
      const safety = folder ?? (await pickFolder());
      if (!safety) return;
      const chosen = await openDialog({
        title: "Choose a backup to restore",
        filters: [{ name: "Database backup", extensions: ["db"] }],
      });
      if (typeof chosen !== "string") return;
      setBusy("restore");
      if (!(await validateBackupFile(chosen))) {
        alert("That file doesn't look like a Refill Tracker database — nothing was changed.");
        return;
      }
      const ok = await confirmDestructive(
        `Restore from:\n${chosen}\n\nThis replaces ALL current data with the backup's contents. ` +
          `A safety snapshot of today's data is saved to the backup folder first.\n\nThe app restarts after the restore.`,
        { title: "Restore database", action: "Restore" },
      );
      if (!ok) return;
      await restoreDatabase(chosen, safety); // does not return on success — app relaunches
    } catch (e) {
      alert(`Restore failed — your current data is untouched.\n${e}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <h3 className="s-sub">Database</h3>
      <p className="s-path">
        {dbPath}{" "}
        <button onClick={() => revealItemInDir(dbPath).catch((e) => alert(String(e)))}>Open folder</button>
      </p>

      <h3 className="s-sub">Back up</h3>
      <p className="s-hint">
        Writes a timestamped snapshot (safe while the app is running) to your backup folder
        {folder ? `: ${folder}` : " — you'll choose one the first time"}.
      </p>
      <p>
        <button className="s-primary" disabled={busy !== null} onClick={backupNow}>
          {busy === "backup" ? "Backing up…" : "Back up now"}
        </button>{" "}
        <button disabled={busy !== null} onClick={pickFolder}>
          Change folder…
        </button>
      </p>
      {lastBackup && <p className="s-ok">Backup written: {lastBackup}</p>}

      <h3 className="s-sub">Restore</h3>
      <p className="s-hint">
        Replaces all current data with a chosen backup. A pre-restore safety snapshot is taken automatically, and the
        app restarts.
      </p>
      <button className="s-danger" disabled={busy !== null} onClick={restore}>
        {busy === "restore" ? "Restoring…" : "Restore from backup…"}
      </button>
    </div>
  );
}

function AboutSection({
  darkMode,
  onDarkModeChange,
}: Pick<SettingsViewProps, "darkMode" | "onDarkModeChange">) {
  const [version, setVersion] = useState("");
  const [busy, setBusy] = useState(false);
  const [themeError, setThemeError] = useState("");

  useEffect(() => {
    getVersion().then(setVersion).catch(console.error);
  }, []);

  const checkNow = async () => {
    setBusy(true);
    try {
      await checkForUpdateManual();
    } finally {
      setBusy(false);
    }
  };

  const changeDarkMode = (enabled: boolean) => {
    setThemeError(
      onDarkModeChange(enabled)
        ? ""
        : "The theme changed for this session, but the preference could not be remembered.",
    );
  };

  return (
    <div>
      <h3 className="s-sub">Appearance</h3>
      <div className="theme-setting">
        <div>
          <div className="theme-setting-title">Dark mode</div>
          <p className="s-hint">Use charcoal surfaces to reduce glare.</p>
        </div>
        <label className="theme-toggle">
          <input
            type="checkbox"
            role="switch"
            checked={darkMode}
            onChange={(e) => changeDarkMode(e.target.checked)}
          />
          <span className="theme-toggle-track" aria-hidden="true">
            <span className="theme-toggle-knob" />
          </span>
          <span>{darkMode ? "On" : "Off"}</span>
        </label>
      </div>
      {themeError && <p className="s-error">{themeError}</p>}

      <h3 className="s-sub">Refill Tracker</h3>
      <p className="s-hint">Version {version ? `v${version}` : "…"}</p>
      <p>
        <button className="s-primary" disabled={busy} onClick={checkNow}>
          {busy ? "Checking…" : "Check for updates"}
        </button>
      </p>
      <p className="s-hint">Updates are published by the owner. The app checks automatically at launch.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------

export default function SettingsView({
  lookups,
  onChanged,
  darkMode,
  onDarkModeChange,
}: SettingsViewProps) {
  const [section, setSection] = useState<SectionKey>("insurances");
  return (
    <div className="settings">
      <nav className="s-sidebar">
        {SECTIONS.map((s) => (
          <button key={s.key} className={section === s.key ? "s-nav on" : "s-nav"} onClick={() => setSection(s.key)}>
            {s.label}
          </button>
        ))}
      </nav>
      <div className="s-body">
        {section === "insurances" && <InsuranceSection lookups={lookups} onChanged={onChanged} />}
        {section === "secondary" && (
          <FlatSection
            onChanged={onChanged}
            table="secondary_coverages"
            rows={lookups.secondaryCoverages}
            what="secondary coverage"
            withLogo
          />
        )}
        {section === "refillNotes" && (
          <FlatSection
            onChanged={onChanged}
            table="refill_notes"
            rows={lookups.refillNotes}
            what="refill note"
            withColor
            withNoteFlags
          />
        )}
        {section === "callNotes" && (
          <FlatSection
            onChanged={onChanged}
            table="call_notes"
            rows={lookups.callNotes}
            what="call note"
            withColor
            withFollowupFlag
          />
        )}
        {section === "thresholds" && <ThresholdsSection lookups={lookups} onChanged={onChanged} />}
        {section === "backup" && <BackupSection lookups={lookups} onChanged={onChanged} />}
        {section === "about" && (
          <AboutSection darkMode={darkMode} onDarkModeChange={onDarkModeChange} />
        )}
      </div>
    </div>
  );
}
