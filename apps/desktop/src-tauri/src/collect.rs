//! Collect selected originals. Resolves each selected UUID against the local manifest and copies
//! the matched original into a `Selected Photos/` folder. UUID matching is authoritative here
//! (the cloud always stores the UUID); the filename fallback in `@photobooth/core` is only for
//! re-imported/legacy manifests. Never touches originals.

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
        // UUID match is authoritative for collection (the cloud always stores the UUID).
        match by_uuid.get(uuid.as_str()).copied() {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(uuid: &str, name: &str, path: &str) -> ManifestEntry {
        ManifestEntry {
            uuid: uuid.into(),
            original_filename: name.into(),
            original_path: path.into(),
            content_hash: format!("h-{uuid}"),
        }
    }

    #[test]
    fn copies_selected_originals_by_uuid() {
        let tmp = std::env::temp_dir().join(format!("pb-collect-{}", uuid::Uuid::new_v4()));
        let src = tmp.join("src");
        fs::create_dir_all(&src).unwrap();
        // two real source files with the SAME filename but different folders (collision case)
        let a = src.join("camA");
        let b = src.join("camB");
        fs::create_dir_all(&a).unwrap();
        fs::create_dir_all(&b).unwrap();
        fs::write(a.join("IMG_1.jpg"), b"AAA").unwrap();
        fs::write(b.join("IMG_1.jpg"), b"BBBB").unwrap();

        let manifest = vec![
            entry("u-a", "IMG_1.jpg", a.join("IMG_1.jpg").to_str().unwrap()),
            entry("u-b", "IMG_1.jpg", b.join("IMG_1.jpg").to_str().unwrap()),
        ];

        // select only camera B's copy, plus a missing uuid
        let report =
            collect_selected(&["u-b".into(), "missing".into()], &manifest, &tmp).unwrap();

        assert_eq!(report.copied, 1);
        assert_eq!(report.unmatched, vec!["missing".to_string()]);
        let copied = fs::read(tmp.join("Selected Photos").join("IMG_1.jpg")).unwrap();
        assert_eq!(copied, b"BBBB"); // got camera B's bytes, not camera A's
        fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn skips_already_collected_files() {
        let tmp = std::env::temp_dir().join(format!("pb-collect2-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&tmp).unwrap();
        fs::write(tmp.join("o.jpg"), b"x").unwrap();
        let manifest = vec![entry("u1", "o.jpg", tmp.join("o.jpg").to_str().unwrap())];

        let first = collect_selected(&["u1".into()], &manifest, &tmp).unwrap();
        assert_eq!(first.copied, 1);
        let second = collect_selected(&["u1".into()], &manifest, &tmp).unwrap();
        assert_eq!(second.copied, 0);
        assert_eq!(second.skipped_existing, 1);
        fs::remove_dir_all(&tmp).ok();
    }
}
