import { useCallback, useEffect, useRef, useState } from "react";
import { loadLookups } from "./data/lookups";
import { loadOverduePendingCount, todayIso } from "./data/refills";
import type { Lookups } from "./data/types";
import MonthView, { type MonthNavRequest } from "./components/MonthView";
import OverdueView from "./components/OverdueView";
import SettingsView from "./components/SettingsView";
import "./App.css";

type Tab = "month" | "overdue" | "settings";

function App() {
  const [lookups, setLookups] = useState<Lookups | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("month");
  // badge = actionable count (Pending past due); MISSED rows are the permanent
  // record and would grow the badge forever — see OverdueView
  const [overdueCount, setOverdueCount] = useState(0);
  const [monthNav, setMonthNav] = useState<MonthNavRequest | null>(null);
  const navSeq = useRef(0);

  useEffect(() => {
    loadLookups().then(setLookups).catch((e) => setError(String(e)));
  }, []);

  // Settings edits re-fetch the whole bundle; the fresh prop flows to every
  // view and reload-on-activation covers grid data (design doc §6.6)
  const reloadLookups = useCallback(() => {
    loadLookups().then(setLookups).catch((e) => alert(`Reloading settings failed.\n${e}`));
  }, []);

  const refreshOverdueCount = useCallback(() => {
    loadOverduePendingCount(todayIso()).then(setOverdueCount).catch(console.error);
  }, []);

  useEffect(() => {
    if (lookups) refreshOverdueCount();
  }, [lookups, refreshOverdueCount]);

  /** the Overdue tab wants a refill opened in the month grid (drawer history click) */
  const openInMonth = useCallback((id: number, dueDate: string) => {
    navSeq.current += 1;
    setMonthNav({ id, dueDate, seq: navSeq.current });
    setTab("month");
  }, []);

  if (error) {
    return (
      <main className="page">
        <h1>Database error</h1>
        <pre>{error}</pre>
      </main>
    );
  }

  if (!lookups) {
    return <main className="page">Loading…</main>;
  }

  // both views stay mounted so tab switches keep month/filter/sort state;
  // the inactive one is display:none and reloads its data on re-activation
  return (
    <div className="app">
      <nav className="tabs">
        <button className={tab === "month" ? "tab on" : "tab"} onClick={() => setTab("month")}>
          Month
        </button>
        <button className={tab === "overdue" ? "tab on" : "tab"} onClick={() => setTab("overdue")}>
          Overdue
          {overdueCount > 0 && <span className="tab-badge">{overdueCount}</span>}
        </button>
        <button className={tab === "settings" ? "tab on" : "tab"} onClick={() => setTab("settings")}>
          Settings
        </button>
      </nav>
      <div className={tab === "month" ? "tab-page" : "tab-page off"}>
        <MonthView lookups={lookups} active={tab === "month"} navRequest={monthNav} onDataChanged={refreshOverdueCount} />
      </div>
      <div className={tab === "overdue" ? "tab-page" : "tab-page off"}>
        <OverdueView lookups={lookups} active={tab === "overdue"} onOpenInMonth={openInMonth} onDataChanged={refreshOverdueCount} />
      </div>
      <div className={tab === "settings" ? "tab-page" : "tab-page off"}>
        <SettingsView lookups={lookups} onChanged={reloadLookups} />
      </div>
    </div>
  );
}

export default App;
