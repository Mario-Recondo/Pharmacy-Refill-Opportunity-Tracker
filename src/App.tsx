import { useEffect, useState } from "react";
import { loadLookups } from "./data/lookups";
import type { Lookups } from "./data/types";
import MonthView from "./components/MonthView";
import "./App.css";

function App() {
  const [lookups, setLookups] = useState<Lookups | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadLookups().then(setLookups).catch((e) => setError(String(e)));
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

  return (
    <div className="app">
      <MonthView lookups={lookups} />
    </div>
  );
}

export default App;
