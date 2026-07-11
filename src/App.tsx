import { useEffect, useState } from "react";
import { getDb } from "./db";
import "./App.css";

// Temporary schema-verification screen: proves migrations ran and seeds landed.
// Replaced by the real grid UI as v1 development proceeds.

interface Lookup {
  id: number;
  name: string;
  color: string;
  sort_order: number;
}

interface Setting {
  key: string;
  value: string;
}

function App() {
  const [insurances, setInsurances] = useState<Lookup[]>([]);
  const [refillNotes, setRefillNotes] = useState<Lookup[]>([]);
  const [callNotes, setCallNotes] = useState<Lookup[]>([]);
  const [settings, setSettings] = useState<Setting[]>([]);
  const [refillCount, setRefillCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const db = await getDb();
        setInsurances(await db.select("SELECT id, name, color, sort_order FROM insurances ORDER BY sort_order"));
        setRefillNotes(await db.select("SELECT id, name, color, sort_order FROM refill_notes ORDER BY sort_order"));
        setCallNotes(await db.select("SELECT id, name, color, sort_order FROM call_notes ORDER BY sort_order"));
        setSettings(await db.select("SELECT key, value FROM settings ORDER BY key"));
        const rows: { n: number }[] = await db.select("SELECT COUNT(*) AS n FROM refills");
        setRefillCount(rows[0]?.n ?? 0);
      } catch (e) {
        setError(String(e));
      }
    })();
  }, []);

  if (error) {
    return (
      <main className="page">
        <h1>Database error</h1>
        <pre>{error}</pre>
      </main>
    );
  }

  const darkPills = new Set(["Coupon Only", "Cashed Out", "Discontinued", "Fax not sent", "TRY AGAIN LATER"]);

  const pills = (items: Lookup[]) => (
    <div className="pills">
      {items.map((i) => (
        <span key={i.id} className="pill" style={{ background: i.color, color: darkPills.has(i.name) ? "#fff" : "#222" }}>
          {i.name}
        </span>
      ))}
    </div>
  );

  return (
    <main className="page">
      <h1>Refill Tracker — schema check</h1>
      <p className="status">
        Database loaded, migrations applied. Refills table: <b>{refillCount ?? "…"}</b> rows (expected 0 on first run).
      </p>
      <h2>Insurances ({insurances.length})</h2>
      {pills(insurances)}
      <h2>Refill notes ({refillNotes.length})</h2>
      {pills(refillNotes)}
      <h2>Call notes ({callNotes.length})</h2>
      {pills(callNotes)}
      <h2>Settings ({settings.length})</h2>
      <table className="settings">
        <tbody>
          {settings.map((s) => (
            <tr key={s.key}>
              <td>{s.key}</td>
              <td>
                <code>{s.value}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

export default App;
