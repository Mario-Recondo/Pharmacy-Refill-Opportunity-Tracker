// Development-only diagnostics dashboard.
//
// This file is NEVER part of a production bundle: App.tsx reaches it through a
// dynamic import that sits behind `import.meta.env.DEV`, which Vite replaces
// with a literal `false` when building for release. Rollup then has no live
// reference to this module and emits no chunk for it. `scripts/check-prod-bundle.mjs`
// asserts exactly that by searching the built output for DEV_DASHBOARD_MARKER.
//
// Deliberately plain: labels, numbers and tables. The job is reading densely,
// not looking good.

import { useEffect, useState, type ReactNode } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { describeLabel, describeOperation } from "./metricDescriptions";
import {
  getDiagnosticsSnapshot,
  resetDiagnostics,
  MAX_ERRORS,
  MAX_SAMPLES,
  type DiagnosticsSnapshot,
  type OperationSample,
} from "../../lib/diagnostics";
import "./devDashboard.css";

/** Sentinel the production-bundle check greps for. Must stay a plain literal. */
export const DEV_DASHBOARD_MARKER = "__REFILL_TRACKER_DEV_DASHBOARD__";

/** How often the panel re-reads the store. Polling beats a subscription here:
 *  no notification plumbing, and a dashboard a second out of date is fine. */
const REFRESH_MS = 1000;

function ms(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(2)}s`;
  if (value >= 10) return `${value.toFixed(0)}ms`;
  return `${value.toFixed(1)}ms`;
}

function duration(totalMs: number): string {
  const s = Math.floor(totalMs / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

function clockTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString(undefined, { hour12: false });
}

function metaText(meta: OperationSample["meta"]): string {
  if (!meta) return "";
  return Object.entries(meta)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
}

/** Latest sample for an operation, or undefined if it has not run this session. */
function latest(snapshot: DiagnosticsSnapshot, name: string): OperationSample | undefined {
  return snapshot.recent.find((sample) => sample.name === name);
}

// Every label, header and operation name carries its own hover text. Native
// `title` rather than a styled tooltip on purpose: the panel body scrolls, and
// an in-page tooltip would be clipped at its edge. OS tooltips never clip.

/** One label/value row in a stats block, with hover text on the label. */
function Stat({ label, value, bad }: { label: string; value: ReactNode; bad?: boolean }) {
  return (
    <div>
      <dt title={describeLabel(label)}>{label}</dt>
      <dd className={bad ? "bad" : undefined}>{value}</dd>
    </div>
  );
}

/** Table header cell with hover text. */
function Th({ label }: { label: string }) {
  return <th title={describeLabel(label)}>{label}</th>;
}

/** Operation name cell with hover text describing what it measures. */
function OpName({ name }: { name: string }) {
  return <td className="devdash-name" title={describeOperation(name)}>{name}</td>;
}

export default function DevDashboard({ onClose }: { onClose: () => void }) {
  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot | null>(getDiagnosticsSnapshot);
  const [version, setVersion] = useState("—");
  const [tick, setTick] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setSnapshot(getDiagnosticsSnapshot());
      setTick(Date.now());
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    // Only resolves when running under Tauri; a bare `vite dev` has no app API.
    getVersion().then(setVersion).catch(() => setVersion("n/a (no Tauri host)"));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!snapshot) return null;

  const lastImport = latest(snapshot, "import.commit");
  const startup = latest(snapshot, "startup.lookups");
  const failures = snapshot.operations.reduce((total, op) => total + op.failures, 0);

  return (
    <aside className="devdash" data-marker={DEV_DASHBOARD_MARKER} aria-label="Developer diagnostics">
      <header className="devdash-header">
        <h2>Diagnostics</h2>
        <span className="devdash-badge">dev build</span>
        <div className="devdash-actions">
          <button onClick={() => { resetDiagnostics(); setSnapshot(getDiagnosticsSnapshot()); }}>
            Reset
          </button>
          <button onClick={onClose} title="Close (Esc or Ctrl+Shift+D)">×</button>
        </div>
      </header>

      <div className="devdash-body">
        <section>
          <h3>Session</h3>
          <dl className="devdash-stats">
            <Stat label="Uptime" value={duration(tick - snapshot.sessionStartedAt)} />
            <Stat label="App version" value={version} />
            <Stat label="Startup (lookups)" value={startup ? ms(startup.durationMs) : "—"} />
            <Stat label="Operations recorded" value={snapshot.totalRecorded} />
            <Stat label="Failures" value={failures} bad={failures > 0} />
            <Stat
              label="Retention"
              value={
                `${snapshot.recent.length}/${MAX_SAMPLES} samples` +
                (snapshot.evictedSamples > 0 ? ` · ${snapshot.evictedSamples} evicted` : "")
              }
            />
          </dl>
          {snapshot.droppedNames > 0 && (
            <p className="devdash-warn">
              {snapshot.droppedNames} operation name(s) refused — the name cap was hit, which
              means some call site is building names dynamically. Fix the caller.
            </p>
          )}
        </section>

        <section>
          <h3>Operations <small>slowest average first</small></h3>
          {snapshot.operations.length === 0 ? (
            <p className="devdash-empty">Nothing recorded yet — use the app and this fills in.</p>
          ) : (
            <table className="devdash-table">
              <thead>
                <tr>
                  <Th label="Operation" /><Th label="Count" /><Th label="Fail" />
                  <Th label="Avg" /><Th label="Max" /><Th label="Last" />
                </tr>
              </thead>
              <tbody>
                {snapshot.operations.map((op) => (
                  <tr key={op.name}>
                    <OpName name={op.name} />
                    <td>{op.count}</td>
                    <td className={op.failures > 0 ? "bad" : undefined}>{op.failures}</td>
                    <td>{ms(op.avgMs)}</td>
                    <td>{ms(op.maxMs)}</td>
                    <td>{ms(op.lastMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section>
          <h3>Slowest recent calls</h3>
          {snapshot.slowest.length === 0 ? (
            <p className="devdash-empty">—</p>
          ) : (
            <table className="devdash-table">
              <thead>
                <tr><Th label="At" /><Th label="Operation" /><Th label="Duration" /><Th label="Detail" /></tr>
              </thead>
              <tbody>
                {snapshot.slowest.map((sample) => (
                  <tr key={sample.id}>
                    <td>{clockTime(sample.startedAt)}</td>
                    <OpName name={sample.name} />
                    <td>{ms(sample.durationMs)}</td>
                    <td className="devdash-meta">{metaText(sample.meta)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section>
          <h3>Last import</h3>
          {!lastImport ? (
            <p className="devdash-empty">No import committed this session.</p>
          ) : (
            <dl className="devdash-stats">
              <Stat label="Duration" value={ms(lastImport.durationMs)} />
              <Stat label="Outcome" value={lastImport.ok ? "ok" : "failed"} bad={!lastImport.ok} />
              {Object.entries(lastImport.meta ?? {}).map(([key, value]) => (
                <Stat key={key} label={key} value={String(value)} />
              ))}
              {lastImport.meta?.planned && lastImport.durationMs > 0 && (
                <Stat
                  label="Rate"
                  value={`${(Number(lastImport.meta.planned) / (lastImport.durationMs / 1000)).toFixed(0)} rows/s`}
                />
              )}
            </dl>
          )}
        </section>

        <section>
          <h3>Errors <small>most recent {MAX_ERRORS} kept</small></h3>
          {snapshot.errors.length === 0 ? (
            <p className="devdash-empty">None.</p>
          ) : (
            <table className="devdash-table">
              <thead>
                <tr><Th label="At" /><Th label="Operation" /><Th label="Duration" /><Th label="Error" /></tr>
              </thead>
              <tbody>
                {snapshot.errors.map((sample) => (
                  <tr key={sample.id}>
                    <td>{clockTime(sample.startedAt)}</td>
                    <OpName name={sample.name} />
                    <td>{ms(sample.durationMs)}</td>
                    <td className="devdash-error">{sample.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <p className="devdash-foot">
          Hover any underlined label or operation name for what it measures. In-memory only —
          everything resets when the app restarts. Metrics carry counts and durations, never
          patient data.
        </p>
      </div>
    </aside>
  );
}
