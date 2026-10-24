//! SQLite access. One connection, guarded by a mutex, opened on the per-user application data
//! directory. The frontend talks to it only through the three commands at the bottom of this file;
//! statements are parameterised and batches run in a single transaction.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{params_from_iter, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Number, Value};

use crate::error::{AppError, AppResult};

pub struct Db {
    pub path: PathBuf,
    pub conn: Mutex<Option<Connection>>,
}

impl Db {
    pub fn open(path: PathBuf) -> AppResult<Self> {
        let conn = open_connection(&path)?;
        Ok(Db { path, conn: Mutex::new(Some(conn)) })
    }

    /// Runs `f` against the live connection; errors if the database is closed (during a restore).
    pub fn with_conn<T>(&self, f: impl FnOnce(&mut Connection) -> AppResult<T>) -> AppResult<T> {
        let mut guard = self.conn.lock().map_err(|_| AppError::invalid("database lock poisoned"))?;
        match guard.as_mut() {
            Some(conn) => f(conn),
            None => Err(AppError::invalid("database is closed")),
        }
    }

    /// Closes the connection (checkpointing the WAL) so the file can be replaced.
    pub fn close(&self) -> AppResult<()> {
        let mut guard = self.conn.lock().map_err(|_| AppError::invalid("database lock poisoned"))?;
        if let Some(conn) = guard.take() {
            conn.close().map_err(|(_, e)| AppError::Sqlite(e))?;
        }
        Ok(())
    }

    pub fn reopen(&self) -> AppResult<()> {
        let mut guard = self.conn.lock().map_err(|_| AppError::invalid("database lock poisoned"))?;
        *guard = Some(open_connection(&self.path)?);
        Ok(())
    }

    /// Writes a consistent snapshot of the database to `dest` without blocking readers for long.
    pub fn snapshot_to(&self, dest: &Path) -> AppResult<()> {
        if dest.exists() {
            std::fs::remove_file(dest)?;
        }
        let dest_str = dest
            .to_str()
            .ok_or_else(|| AppError::invalid("snapshot path is not valid UTF-8"))?
            .replace('\'', "''");
        self.with_conn(|conn| {
            conn.execute_batch(&format!("VACUUM INTO '{dest_str}'"))?;
            Ok(())
        })
    }
}

pub fn open_connection(path: &Path) -> AppResult<Connection> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA foreign_keys = ON;
         PRAGMA temp_store = MEMORY;",
    )?;
    Ok(conn)
}

/// Opens a database file read-only and checks that it is a healthy workbench database.
pub fn validate_database_file(path: &Path) -> AppResult<()> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let check: String = conn.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
    if check != "ok" {
        return Err(AppError::invalid(format!("database integrity check failed: {check}")));
    }
    let has_schema: i64 = conn.query_row(
        "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
        [],
        |r| r.get(0),
    )?;
    if has_schema == 0 {
        return Err(AppError::invalid("file is not a DM Workbench database (no schema_migrations table)"));
    }
    Ok(())
}

fn json_to_sql(value: &Value) -> SqlValue {
    match value {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(*b as i64),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                SqlValue::Integer(i)
            } else {
                SqlValue::Real(n.as_f64().unwrap_or(0.0))
            }
        }
        Value::String(s) => SqlValue::Text(s.clone()),
        other => SqlValue::Text(other.to_string()),
    }
}

fn sql_to_json(value: ValueRef<'_>) -> Value {
    match value {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => Value::Number(i.into()),
        ValueRef::Real(f) => Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null),
        ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => Value::Array(b.iter().map(|x| Value::Number((*x).into())).collect()),
    }
}

#[derive(Serialize)]
pub struct ExecResult {
    pub changes: i64,
    pub last_insert_rowid: i64,
}

#[derive(Deserialize)]
pub struct Statement {
    pub sql: String,
    #[serde(default)]
    pub params: Vec<Value>,
    /// When set, the batch is rolled back unless the statement changed exactly this many rows.
    #[serde(default)]
    pub expect_changes: Option<i64>,
}

pub fn select(conn: &Connection, sql: &str, params: &[Value]) -> AppResult<Vec<Map<String, Value>>> {
    let mut stmt = conn.prepare(sql)?;
    let column_names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let sql_params: Vec<SqlValue> = params.iter().map(json_to_sql).collect();
    let mut rows = stmt.query(params_from_iter(sql_params.iter()))?;
    let mut out = Vec::new();
    while let Some(row) = rows.next()? {
        let mut object = Map::with_capacity(column_names.len());
        for (i, name) in column_names.iter().enumerate() {
            object.insert(name.clone(), sql_to_json(row.get_ref(i)?));
        }
        out.push(object);
    }
    Ok(out)
}

pub fn execute(conn: &Connection, sql: &str, params: &[Value]) -> AppResult<ExecResult> {
    let sql_params: Vec<SqlValue> = params.iter().map(json_to_sql).collect();
    let changes = conn.execute(sql, params_from_iter(sql_params.iter()))? as i64;
    Ok(ExecResult { changes, last_insert_rowid: conn.last_insert_rowid() })
}

/// Clears a leftover BEGIN (failed migration / script) so `transaction()` can start cleanly.
fn abandon_open_transaction(conn: &Connection) {
    if !conn.is_autocommit() {
        let _ = conn.execute_batch("ROLLBACK");
    }
}

pub fn batch(conn: &mut Connection, statements: &[Statement]) -> AppResult<Vec<ExecResult>> {
    abandon_open_transaction(conn);
    let tx = conn.transaction()?;
    let mut results = Vec::with_capacity(statements.len());
    for (index, statement) in statements.iter().enumerate() {
        let result = execute(&tx, &statement.sql, &statement.params)?;
        if let Some(expected) = statement.expect_changes {
            if result.changes != expected {
                return Err(AppError::invalid(format!(
                    "batch statement {index} changed {} rows, expected {expected}; transaction rolled back",
                    result.changes
                )));
            }
        }
        results.push(result);
    }
    tx.commit()?;
    Ok(results)
}

#[tauri::command]
pub fn db_select(db: tauri::State<'_, Db>, sql: String, params: Vec<Value>) -> AppResult<Vec<Map<String, Value>>> {
    db.with_conn(|conn| select(conn, &sql, &params))
}

#[tauri::command]
pub fn db_execute(db: tauri::State<'_, Db>, sql: String, params: Vec<Value>) -> AppResult<ExecResult> {
    db.with_conn(|conn| execute(conn, &sql, &params))
}

#[tauri::command]
pub fn db_batch(db: tauri::State<'_, Db>, statements: Vec<Statement>) -> AppResult<Vec<ExecResult>> {
    db.with_conn(|conn| batch(conn, &statements))
}

#[tauri::command]
pub fn db_execute_script(db: tauri::State<'_, Db>, sql: String) -> AppResult<()> {
    db.with_conn(|conn| {
        if let Err(error) = conn.execute_batch(&sql) {
            abandon_open_transaction(conn);
            return Err(error.into());
        }
        Ok(())
    })
}
