use calamine::{open_workbook_auto, Data, Reader};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::io::Read;
use tauri::Manager;
use tauri_plugin_sql::{DbInstances, DbPool, Migration, MigrationKind};

#[derive(Deserialize)]
struct BatchStatement {
    sql: String,
    params: Vec<serde_json::Value>,
}

#[derive(Serialize)]
struct ImportSheet {
    headers: Vec<String>,
    rows: Vec<Vec<serde_json::Value>>,
}

/// Excel serial date (days since 1899-12-30) → ISO yyyy-mm-dd, no chrono
/// dependency. Valid for serials ≥ 61 (post the fictitious 1900-02-29);
/// Pioneer due dates are all modern. Civil-from-days per Howard Hinnant.
fn excel_serial_to_iso(serial: f64) -> Option<String> {
    if !serial.is_finite() || serial < 61.0 {
        return None;
    }
    let days = serial.floor() as i64 - 25569; // rebase to 1970-01-01
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    Some(format!("{:04}-{:02}-{:02}", y, m, d))
}

fn normalize_cell(cell: &Data) -> serde_json::Value {
    match cell {
        Data::Empty | Data::Error(_) => serde_json::Value::Null,
        Data::String(s) => json!(s.trim()),
        Data::Bool(v) => json!(v),
        Data::Int(v) => json!(v),
        Data::Float(v) if v.fract() == 0.0 => json!(*v as i64),
        Data::Float(v) => json!(v),
        Data::DateTime(v) => excel_serial_to_iso(v.as_f64())
            .map(|d| json!(d))
            .unwrap_or(serde_json::Value::Null),
        Data::DateTimeIso(s) | Data::DurationIso(s) => json!(s.trim()),
    }
}

fn normalize_xlsx_row(source: &[Data], rx_col: Option<usize>) -> Vec<serde_json::Value> {
    let mut row: Vec<_> = source.iter().map(normalize_cell).collect();
    if let Some(i) = rx_col { if let Some(serde_json::Value::Number(n)) = row.get(i) { if let Some(v) = n.as_i64() { row[i] = json!(v.to_string()); } } }
    row
}

fn read_csv<R: Read>(reader: R) -> Result<ImportSheet, String> {
    let mut csv = csv::ReaderBuilder::new().flexible(true).from_reader(reader);
    let headers: Vec<String> = csv.headers().map_err(|e| e.to_string())?.iter().enumerate().map(|(i,s)| if i == 0 { s.trim_start_matches('\u{feff}').trim().to_owned() } else { s.trim().to_owned() }).collect();
    if headers.is_empty() || headers.iter().all(|s| s.is_empty()) { return Err("The spreadsheet has no headers".into()); }
    let mut rows = Vec::new();
    for record in csv.records() {
        let record = record.map_err(|e| e.to_string())?;
        if record.iter().all(|s| s.trim().is_empty()) { continue; }
        let mut row: Vec<serde_json::Value> = record.iter().map(|s| json!(s.trim())).collect();
        if row.len() < headers.len() { row.resize(headers.len(), serde_json::Value::Null); }
        if row.len() > headers.len() { row.push(json!({"__overflow": true})); }
        rows.push(row);
    }
    if rows.is_empty() { return Err("The spreadsheet has no data rows".into()); }
    Ok(ImportSheet { headers, rows })
}

#[tauri::command]
fn read_spreadsheet(path: String) -> Result<ImportSheet, String> {
    let extension = std::path::Path::new(&path).extension().and_then(|s| s.to_str()).unwrap_or("").to_ascii_lowercase();
    if extension == "csv" { return read_csv(std::fs::File::open(&path).map_err(|e| e.to_string())?); }
    if extension != "xlsx" && extension != "xls" { return Err("Choose an .xlsx, .xls, or .csv file".into()); }
    let mut workbook = open_workbook_auto(&path).map_err(|e| e.to_string())?;
    let name = workbook.sheet_names().first().cloned().ok_or("The workbook has no worksheets")?;
    let range = workbook.worksheet_range(&name).map_err(|e| e.to_string())?;
    let mut iter = range.rows();
    let raw_headers = iter.next().ok_or("The workbook has no header row")?;
    let headers: Vec<String> = raw_headers.iter().map(|c| match normalize_cell(c) { serde_json::Value::String(s) => s, v => v.to_string() }).map(|s| s.trim().to_owned()).collect();
    if headers.is_empty() || headers.iter().all(|s| s.is_empty()) { return Err("The workbook has no headers".into()); }
    let rx_col = headers.iter().position(|h| h.eq_ignore_ascii_case("Rx Number"));
    let mut rows = Vec::new();
    for source in iter {
        if source.iter().all(|c| { let v = normalize_cell(c); v.is_null() || v.as_str().map(|s| s.is_empty()).unwrap_or(false) }) { continue; }
        let mut row = normalize_xlsx_row(source, rx_col);
        row.resize(headers.len(), serde_json::Value::Null);
        rows.push(row);
    }
    if rows.is_empty() { return Err("The workbook has no data rows".into()); }
    Ok(ImportSheet { headers, rows })
}

/// All-or-nothing write batch (SQL review 2026-07-15, M1/M2; ADR 0003).
/// tauri-plugin-sql pools up to 10 SQLite connections and each execute() grabs
/// whichever is free, so BEGIN/COMMIT issued from JS can land on different
/// connections — a real transaction is only possible down here, on one
/// connection borrowed from the plugin's own pool. Any statement failing rolls
/// back the whole batch (sqlx Transaction drop = ROLLBACK).
#[tauri::command]
async fn execute_batch(
    app: tauri::AppHandle,
    db: String,
    statements: Vec<BatchStatement>,
) -> Result<(), String> {
    let pool = {
        let instances = app.state::<DbInstances>();
        let lock = instances.0.read().await;
        match lock.get(&db) {
            Some(DbPool::Sqlite(pool)) => pool.clone(),
            _ => return Err(format!("database {db} is not loaded")),
        }
    };
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    for stmt in &statements {
        let mut query = sqlx::query(&stmt.sql);
        for value in &stmt.params {
            // same JSON→SQL mapping tauri-plugin-sql applies, so values written
            // through either path compare equal in the database
            if value.is_null() {
                query = query.bind(None::<String>);
            } else if let Some(s) = value.as_str() {
                query = query.bind(s.to_owned());
            } else if let Some(n) = value.as_f64() {
                query = query.bind(n);
            } else if let Some(b) = value.as_bool() {
                query = query.bind(b);
            } else {
                return Err(format!("unsupported parameter type in: {}", stmt.sql));
            }
        }
        query.execute(&mut *tx).await.map_err(|e| e.to_string())?;
    }
    tx.commit().await.map_err(|e| e.to_string())
}

/// Restore (story 4.3): overwrite the live DB file with a chosen backup, then
/// relaunch. The frontend must close its SQL connection before invoking this;
/// a clean restart is the only state we trust after the DB changes underneath.
#[tauri::command]
fn replace_database_and_restart(app: tauri::AppHandle, source: String) -> Result<(), String> {
    let dest = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("refills.db");
    std::fs::copy(&source, &dest).map_err(|e| e.to_string())?;
    app.restart();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "initial_schema",
            sql: include_str!("../migrations/001_initial_schema.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "seed_lookups",
            sql: include_str!("../migrations/002_seed_lookups.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "sketch_feedback",
            sql: include_str!("../migrations/003_sketch_feedback.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "req_followup",
            sql: include_str!("../migrations/004_req_followup.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "drugs_null_ndc_unique",
            sql: include_str!("../migrations/005_drugs_null_ndc_unique.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "default_groups",
            sql: include_str!("../migrations/006_default_groups.sql"),
            kind: MigrationKind::Up,
        },
        Migration { version: 7, description: "import", sql: include_str!("../migrations/007_import.sql"), kind: MigrationKind::Up },
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:refills.db", migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            replace_database_and_restart,
            execute_batch
            , read_spreadsheet
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_cells_and_rx_column() {
        assert_eq!(normalize_cell(&Data::DateTimeIso("2026-07-01".into())), json!("2026-07-01"));
        assert_eq!(normalize_cell(&Data::Float(3.0)), json!(3));
        assert_eq!(normalize_cell(&Data::String("  Plan  ".into())), json!("Plan"));
        assert_eq!(normalize_cell(&Data::Empty), serde_json::Value::Null);
        let row = normalize_xlsx_row(&[Data::Float(428566.0), Data::Float(25.5)], Some(0));
        assert_eq!(row[0], json!("428566"));
        assert_eq!(row[1], json!(25.5));
    }

    #[test]
    fn converts_excel_serial_dates() {
        // ground truth from the real July 2026 export: serial 46204 = July 1
        assert_eq!(excel_serial_to_iso(46204.0).as_deref(), Some("2026-07-01"));
        assert_eq!(excel_serial_to_iso(46234.0).as_deref(), Some("2026-07-31"));
        assert_eq!(excel_serial_to_iso(46204.99).as_deref(), Some("2026-07-01")); // time-of-day fraction floors
        assert_eq!(excel_serial_to_iso(45658.0).as_deref(), Some("2025-01-01"));
        assert_eq!(excel_serial_to_iso(60.0), None); // pre-1900-03-01 serials unsupported
    }

    #[test]
    fn reads_csv_bom_quotes_padding_and_overflow() {
        let sheet = read_csv("\u{feff}Rx Number,Drug\r\n123,\"Test, Drug\"\r\n456\r\n789,Drug,EXTRA\r\n".as_bytes()).unwrap();
        assert_eq!(sheet.headers, vec!["Rx Number", "Drug"]);
        assert_eq!(sheet.rows[0], vec![json!("123"), json!("Test, Drug")]);
        assert_eq!(sheet.rows[1][1], serde_json::Value::Null);
        assert_eq!(sheet.rows[2].last().unwrap(), &json!({"__overflow": true}));
    }
}
