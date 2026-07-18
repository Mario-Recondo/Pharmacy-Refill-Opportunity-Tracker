use serde::Deserialize;
use tauri::Manager;
use tauri_plugin_sql::{DbInstances, DbPool, Migration, MigrationKind};

#[derive(Deserialize)]
struct BatchStatement {
    sql: String,
    params: Vec<serde_json::Value>,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
