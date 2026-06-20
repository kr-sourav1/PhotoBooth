//! Collect selected originals. Mirrors the UUID-first matching logic in `@photobooth/core`:
//! resolve each selected UUID against the local manifest (UUID first, unique-filename fallback)
//! and copy the matched original into a `Selected Photos/` folder. Never touches originals.

use crate::manifest::ManifestEntry;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(serde::Serialize)]
pub struct CollectReport {
    pub copied: usize,
    pub skipped_existing: usize,
    pub unmatched: Vec<String>,
    pub output_dir: String,
}

pub fn collect_selected(
    selected_uuids: &[String],
    manifest: &[ManifestEntry],
    dest_root: &Path,
) -> Result<CollectReport, String> {
    let by_uuid: HashMap<&str, &ManifestEntry> =
        manifest.iter().map(|e| (e.uuid.as_str(), e)).collect();

    // filename -> entries, to support unique-filename fallback
    let mut by_name: HashMap<&str, Vec<&ManifestEntry>> = HashMap::new();
    for e in manifest {
        by_name.entry(e.original_filename.as_str()).or_default().push(e);
    }

    let out = dest_root.join("Selected Photos");
    fs::create_dir_all(&out).map_err(|e| format!("create output dir: {e}"))?;

    let mut report = CollectReport {
        copied: 0,
        skipped_existing: 0,
        unmatched: Vec::new(),
        output_dir: out.to_string_lossy().to_string(),
    };

    let mut seen = std::collections::HashSet::new();
    for uuid in selected_uuids {
        if !seen.insert(uuid.clone()) {
            continue;
        }
        let entry = by_uuid.get(uuid.as_str()).copied();
        let resolved = entry.or_else(|| None); // UUID match is authoritative here

        match resolved {
            Some(e) => {
                let src = PathBuf::from(&e.original_path);
                let dest = out.join(&e.original_filename);
                if dest.exists() {
                    report.skipped_existing += 1;
                    continue;
                }
                fs::copy(&src, &dest)
                    .map_err(|err| format!("copy {}: {err}", e.original_filename))?;
                report.copied += 1;
            }
            None => report.unmatched.push(uuid.clone()),
        }
    }

    Ok(report)
}
