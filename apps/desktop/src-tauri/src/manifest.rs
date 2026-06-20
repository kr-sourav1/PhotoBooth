//! Local SQLite manifest. Maps each photo's stable UUID to the absolute path of its original
//! high-res file on the studio's machine, so selected originals can be collected later even if
//! the cloud only ever saw the preview. One manifest DB per project.

use rusqlite::{params, Connection};
use std::path::Path;

pub struct ManifestEntry {
    pub uuid: String,
    pub original_filename: String,
    pub original_path: String,
    pub content_hash: String,
}

pub fn open(db_path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(db_path)?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS photos (
            uuid              TEXT PRIMARY KEY,
            original_filename TEXT NOT NULL,
            original_path     TEXT NOT NULL,
            content_hash      TEXT NOT NULL,
            preview_path      TEXT,
            width             INTEGER,
            height            INTEGER
         );
         CREATE INDEX IF NOT EXISTS photos_filename_idx ON photos(original_filename);",
    )?;
    Ok(conn)
}

pub fn insert(
    conn: &Connection,
    e: &ManifestEntry,
    preview_path: &str,
    width: u32,
    height: u32,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO photos
           (uuid, original_filename, original_path, content_hash, preview_path, width, height)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            e.uuid,
            e.original_filename,
            e.original_path,
            e.content_hash,
            preview_path,
            width,
            height
        ],
    )?;
    Ok(())
}

pub fn load_all(conn: &Connection) -> rusqlite::Result<Vec<ManifestEntry>> {
    let mut stmt =
        conn.prepare("SELECT uuid, original_filename, original_path, content_hash FROM photos")?;
    let rows = stmt.query_map([], |r| {
        Ok(ManifestEntry {
            uuid: r.get(0)?,
            original_filename: r.get(1)?,
            original_path: r.get(2)?,
            content_hash: r.get(3)?,
        })
    })?;
    rows.collect()
}
