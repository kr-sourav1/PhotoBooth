//! Tauri command surface for PhotoBooth Studio.
//!
//! Phase 1 commands implemented here:
//!  - `generate_previews`: scan a folder, build previews in parallel, write the SQLite manifest,
//!     emit progress events, and return the per-photo records to upload to the cloud.
//!  - `collect_selected`: copy the client's selected originals into `Selected Photos/`.

mod collect;
mod manifest;
mod preview;

use rayon::prelude::*;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::{AppHandle, Emitter};

#[derive(serde::Serialize, Clone)]
struct Progress {
    done: usize,
    total: usize,
    current: String,
}

#[derive(serde::Serialize)]
struct GenerateOutput {
    manifest_path: String,
    photos: Vec<preview::PreviewResult>,
    failures: Vec<String>,
}

/// Generate previews for every supported image under `source_dir`.
#[tauri::command]
async fn generate_previews(
    app: AppHandle,
    source_dir: String,
    output_dir: String,
    max_edge: u32,
    jpeg_quality: u8,
) -> Result<GenerateOutput, String> {
    let source = PathBuf::from(&source_dir);
    let out = PathBuf::from(&output_dir);
    std::fs::create_dir_all(&out).map_err(|e| format!("create output dir: {e}"))?;

    let images = preview::list_images(&source);
    let total = images.len();
    let counter = AtomicUsize::new(0);

    // Parallel preview generation across CPU cores.
    let results: Vec<Result<preview::PreviewResult, String>> = images
        .par_iter()
        .map(|path| {
            let r = preview::generate_one(path, &out, max_edge, jpeg_quality);
            let done = counter.fetch_add(1, Ordering::SeqCst) + 1;
            let _ = app.emit(
                "preview-progress",
                Progress {
                    done,
                    total,
                    current: path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string(),
                },
            );
            r
        })
        .collect();

    // Persist the manifest and split successes/failures.
    let manifest_path = out.join("manifest.photobooth.sqlite");
    let conn = manifest::open(&manifest_path).map_err(|e| format!("manifest open: {e}"))?;

    let mut photos = Vec::new();
    let mut failures = Vec::new();
    for r in results {
        match r {
            Ok(p) => {
                let entry = manifest::ManifestEntry {
                    uuid: p.uuid.clone(),
                    original_filename: p.original_filename.clone(),
                    original_path: p.original_path.clone(),
                    content_hash: p.content_hash.clone(),
                };
                manifest::insert(&conn, &entry, &p.preview_path, p.width, p.height)
                    .map_err(|e| format!("manifest insert: {e}"))?;
                photos.push(p);
            }
            Err(e) => failures.push(e),
        }
    }

    Ok(GenerateOutput {
        manifest_path: manifest_path.to_string_lossy().to_string(),
        photos,
        failures,
    })
}

/// Copy the selected originals (by UUID) into `<dest_root>/Selected Photos`.
#[tauri::command]
async fn collect_selected(
    manifest_path: String,
    selected_uuids: Vec<String>,
    dest_root: String,
) -> Result<collect::CollectReport, String> {
    let conn = manifest::open(Path::new(&manifest_path)).map_err(|e| format!("manifest open: {e}"))?;
    let entries = manifest::load_all(&conn).map_err(|e| format!("manifest load: {e}"))?;
    collect::collect_selected(&selected_uuids, &entries, Path::new(&dest_root))
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![generate_previews, collect_selected])
        .run(tauri::generate_context!())
        .expect("error while running PhotoBooth Studio");
}
