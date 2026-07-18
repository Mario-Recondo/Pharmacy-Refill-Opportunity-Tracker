import { useCallback, useEffect, useRef, useState } from "react";
import { loadLookups } from "./data/lookups";
import { loadOverduePendingCount, loadReqFollowUpCount, sweepFollowupSpans, todayIso } from "./data/refills";
import type { Lookups } from "./data/types";
import MonthView, { type MonthNavRequest } from "./components/MonthView";
import OverdueView from "./components/OverdueView";
import ReqFollowUpView from "./components/ReqFollowUpView";
import SettingsView from "./components/SettingsView";
import { checkForUpdateOnLaunch } from "./lib/updater";
import "./App.css";

type Tab = "month" | "followup" | "overdue" | "settings";

function App() {
  const [lookups, setLookups] = useState<Lookups | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("month");
  // badge = actionable count (Pending past due, insurance not yet run); MISSED
  // rows are the permanent record and would grow the badge forever — see OverdueView
  const [overdueCount, setOverdueCount] = useState(0);
  // badge = rows currently qualifying for Req Follow Up — all of them actionable
  const [followupCount, setFollowupCount] = useState(0);
  const [monthNav, setMonthNav] = useState<MonthNavRequest | null>(null);
  const navSeq = useRef(0);

  useEffect(() => {
    loadLookups().then(setLookups).catch((e) => setError(String(e)));
    checkForUpdateOnLaunch();
  }, []);

  // Settings edits re-fetch the whole bundle; the fresh prop flows to every
  // view and reload-on-activation covers grid data (design doc §6.6)
  const reloadLookups = useCallback(() => {
    loadLookups().then(setLookups).catch((e) => alert(`Reloading settings failed.\n${e}`));
  }, []);

  const waitDays = lookups?.settings.followupWaitDays ?? 5;

  const refreshBadges = useCallback(() => {
    loadOverduePendingCount(todayIso()).then(setOverdueCount).catch(console.error);
    loadReqFollowUpCount(waitDays).then(setFollowupCount).catch(console.error);
  }, [waitDays]);

  // Any persisted change can move rows in or out of follow-up, so reconcile the
  // followup_entered/followup_left span events (analytics record) before the
  // badges re-count. The sweep never mutates refills.
  const onDataChanged = useCallback(() => {
    sweepFollowupSpans(waitDays).catch(console.error).finally(refreshBadges);
  }, [waitDays, refreshBadges]);

  // launch, and again whenever lookups reload — a Settings change to the wait
  // threshold or a note's requires_followup flag shifts membership
  useEffect(() => {
    if (lookups) onDataChanged();
  }, [lookups, onDataChanged]);

  // day rollover while the app sits open: quiet-day counts and past-due status
  // both shift at midnight, so re-sweep and re-count without waiting for an edit
  useEffect(() => {
    let day = todayIso();
    const timer = setInterval(() => {
      if (todayIso() !== day) {
        day = todayIso();
        onDataChanged();
      }
    }, 60_000);
    return () => clearInterval(timer);
  }, [onDataChanged]);

  /** a tab wants a refill opened in the month grid (drawer history click) */
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

  // all views stay mounted so tab switches keep month/filter/sort state;
  // the inactive ones are display:none and reload their data on re-activation
  return (
    <div className="app">
      <nav className="tabs">
        <div className="brand">
          <span className="brand-mark">Rx</span>
          <span className="brand-name">Refill Tracker</span>
        </div>
        <button className={tab === "month" ? "tab on" : "tab"} onClick={() => setTab("month")}>
          Month
        </button>
        <button className={tab === "followup" ? "tab on" : "tab"} onClick={() => setTab("followup")}>
          Req Follow Up
          {followupCount > 0 && <span className="tab-badge">{followupCount}</span>}
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
        <MonthView lookups={lookups} active={tab === "month"} navRequest={monthNav} onDataChanged={onDataChanged} />
      </div>
      <div className={tab === "followup" ? "tab-page" : "tab-page off"}>
        <ReqFollowUpView lookups={lookups} active={tab === "followup"} onOpenInMonth={openInMonth} onDataChanged={onDataChanged} />
      </div>
      <div className={tab === "overdue" ? "tab-page" : "tab-page off"}>
        <OverdueView lookups={lookups} active={tab === "overdue"} onOpenInMonth={openInMonth} onDataChanged={onDataChanged} />
      </div>
      <div className={tab === "settings" ? "tab-page" : "tab-page off"}>
        <SettingsView lookups={lookups} onChanged={reloadLookups} />
      </div>
    </div>
  );
}

export default App;
