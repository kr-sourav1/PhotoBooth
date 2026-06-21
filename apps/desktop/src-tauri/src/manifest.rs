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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn insert_and_load_roundtrip() {
        let dir = std::env::temp_dir().join(format!("pb-mani-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let db = dir.join("m.sqlite");

        let conn = open(&db).unwrap();
        let e = ManifestEntry {
            uuid: "u1".into(),
            original_filename: "IMG_1.jpg".into(),
            original_path: "/shoot/IMG_1.jpg".into(),
            content_hash: "abc".into(),
        };
        insert(&conn, &e, "u1.jpg", 1600, 1067).unwrap();

        // Re-open to prove it persisted to disk, not just in memory.
        drop(conn);
        let conn2 = open(&db).unwrap();
        let all = load_all(&conn2).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].uuid, "u1");
        assert_eq!(all[0].original_path, "/shoot/IMG_1.jpg");
        std::fs::remove_dir_all(&dir).ok();
    }
}
