//! Upload previews to Cloudflare R2 via presigned PUT URLs (minted by the r2-sign-upload edge
//! function). Done natively in Rust rather than from the webview so there is no CORS dance, and
//! so uploads run in parallel across connections. Original files are never uploaded.

use rayon::prelude::*;
use std::sync::atomic::{AtomicUsize, Ordering};

#[derive(serde::Deserialize)]
pub struct UploadItem {
    /// absolute path to the local preview JPEG
    pub preview_path: String,
    /// presigned PUT URL for this preview's R2 object
    pub url: String,
}

#[derive(serde::Serialize)]
pub struct UploadReport {
    pub uploaded: usize,
    pub failures: Vec<String>,
}

pub fn upload_all<F>(items: &[UploadItem], on_progress: F) -> UploadReport
where
    F: Fn(usize, usize) + Sync + Send,
{
    let total = items.len();
    let counter = AtomicUsize::new(0);

    let results: Vec<Result<(), String>> = items
        .par_iter()
        .map(|item| {
            let r = upload_one(item);
            let done = counter.fetch_add(1, Ordering::SeqCst) + 1;
            on_progress(done, total);
            r
        })
        .collect();

    let mut uploaded = 0;
    let mut failures = Vec::new();
    for r in results {
        match r {
            Ok(()) => uploaded += 1,
            Err(e) => failures.push(e),
        }
    }
    UploadReport { uploaded, failures }
}

fn upload_one(item: &UploadItem) -> Result<(), String> {
    let bytes = std::fs::read(&item.preview_path)
        .map_err(|e| format!("read {}: {e}", item.preview_path))?;
    match ureq::put(&item.url)
        .set("Content-Type", "image/jpeg")
        .send_bytes(&bytes)
    {
        Ok(_) => Ok(()),
        Err(ureq::Error::Status(code, _)) => Err(format!("{}: HTTP {code}", item.preview_path)),
        Err(e) => Err(format!("{}: {e}", item.preview_path)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_failure_for_unreadable_file_without_network() {
        // A non-existent preview path fails at the read step, before any HTTP call — so this is
        // deterministic and offline.
        let items = vec![UploadItem {
            preview_path: "/definitely/not/here.jpg".into(),
            url: "https://example.invalid/object".into(),
        }];
        let seen = std::sync::atomic::AtomicUsize::new(0);
        let report = upload_all(&items, |_d, _t| {
            seen.fetch_add(1, Ordering::SeqCst);
        });
        assert_eq!(report.uploaded, 0);
        assert_eq!(report.failures.len(), 1);
        assert!(report.failures[0].contains("read"));
        assert_eq!(seen.load(Ordering::SeqCst), 1);
    }
}
