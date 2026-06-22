//! Tauri command surface for PhotoBooth Studio.
//!
//! Commands implemented here:
//!  - `generate_previews` (Phase 1): scan a folder, build previews in parallel, write the SQLite
//!     manifest, emit progress events, and return the per-photo records.
//!  - `upload_previews` (Phase 2): PUT previews to R2 via presigned URLs, natively (no CORS).
//!  - `collect_selected` (Phase 4): copy the client's selected originals into `Selected Photos/`.

mod collect;
mod manifest;
mod preview;
mod upload;

use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};

#[derive(serde::Serialize, Clone)]
struct Progress {
    done: usize,
    total: usize,
    current: String,
}

#[derive(serde::Serialize, Clone)]
struct UploadProgress {
    done: usize,
    total: usize,
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
    watermark: Option<String>,
) -> Result<GenerateOutput, String> {
    let source = PathBuf::from(&source_dir);
    let out = PathBuf::from(&output_dir);
    // Start clean so re-running a project doesn't pile up stale previews from a prior run.
    if out.exists() {
        let _ = std::fs::remove_dir_all(&out);
    }
    std::fs::create_dir_all(&out).map_err(|e| format!("create output dir: {e}"))?;

    let images = preview::list_images(&source);
    let watermark = watermark.filter(|s| !s.trim().is_empty());

    // Parallel preview generation (decoupled engine), emitting progress to the UI as each lands.
    let (photos, failures) = preview::generate_batch(
        &images,
        &out,
        max_edge,
        jpeg_quality,
        watermark.as_deref(),
        |done, total, current| {
            let _ = app.emit(
                "preview-progress",
                Progress { done, total, current: current.to_string() },
            );
        },
    );

    // Persist the manifest for every successful preview.
    let manifest_path = out.join("manifest.photobooth.sqlite");
    let conn = manifest::open(&manifest_path).map_err(|e| format!("manifest open: {e}"))?;
    for p in &photos {
        let entry = manifest::ManifestEntry {
            uuid: p.uuid.clone(),
            original_filename: p.original_filename.clone(),
            original_path: p.original_path.clone(),
            content_hash: p.content_hash.clone(),
        };
        manifest::insert(&conn, &entry, &p.preview_path, p.width, p.height)
            .map_err(|e| format!("manifest insert: {e}"))?;
    }

    Ok(GenerateOutput {
        manifest_path: manifest_path.to_string_lossy().to_string(),
        photos,
        failures,
    })
}

/// Upload previews to R2 via presigned PUT URLs. Runs the blocking, parallel uploads off the
/// async runtime so the UI stays responsive, emitting `upload-progress` events.
#[tauri::command]
async fn upload_previews(
    app: AppHandle,
    items: Vec<upload::UploadItem>,
) -> Result<upload::UploadReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        upload::upload_all(&items, |done, total| {
            let _ = app.emit("upload-progress", UploadProgress { done, total });
        })
    })
    .await
    .map_err(|e| format!("upload task: {e}"))
}

/// Delete the local preview JPEGs after they've been uploaded — they live in the cloud now, and
/// only the manifest (uuid → original path) needs to persist locally for collection. Keeps the
/// `.sqlite` manifest, removes the `.jpg` previews, so re-uploads never accumulate on disk.
#[tauri::command]
fn cleanup_previews(preview_dir: String) -> Result<(), String> {
    let dir = Path::new(&preview_dir);
    if !dir.exists() {
        return Ok(());
    }
    for entry in std::fs::read_dir(dir).map_err(|e| format!("read dir: {e}"))? {
        let path = entry.map_err(|e| e.to_string())?.path();
        let is_jpg = path
            .extension()
            .and_then(|x| x.to_str())
            .map(|x| x.eq_ignore_ascii_case("jpg") || x.eq_ignore_ascii_case("jpeg"))
            .unwrap_or(false);
        if is_jpg {
            let _ = std::fs::remove_file(&path);
        }
    }
    Ok(())
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
        .invoke_handler(tauri::generate_handler![
            generate_previews,
            upload_previews,
            cleanup_previews,
            collect_selected
        ])
        .run(tauri::generate_context!())
        .expect("error while running PhotoBooth Studio");
}
