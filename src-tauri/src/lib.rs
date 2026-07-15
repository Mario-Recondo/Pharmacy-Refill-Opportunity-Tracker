use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

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
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:refills.db", migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![replace_database_and_restart])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
