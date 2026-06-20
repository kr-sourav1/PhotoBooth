//! Preview generation engine. Scans a folder of high-res originals and produces small JPEG
//! previews in parallel (rayon), honoring EXIF orientation, while computing a content hash and
//! assigning each photo a stable UUID. Originals are never modified or moved.

use image::ImageReader;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use uuid::Uuid;
use walkdir::WalkDir;

const SUPPORTED: &[&str] = &["jpg", "jpeg", "png", "tif", "tiff", "webp", "heic"];

#[derive(serde::Serialize, Clone)]
pub struct PreviewResult {
    pub uuid: String,
    pub original_filename: String,
    pub original_path: String,
    pub content_hash: String,
    pub preview_path: String,
    pub width: u32,
    pub height: u32,
}

pub fn list_images(dir: &Path) -> Vec<PathBuf> {
    WalkDir::new(dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .map(|e| e.into_path())
        .filter(|p| {
            p.extension()
                .and_then(|x| x.to_str())
                .map(|x| SUPPORTED.contains(&x.to_lowercase().as_str()))
                .unwrap_or(false)
        })
        .collect()
}

/// Generate a single preview. `max_edge` is the longest-side target (e.g. 1600px). Returns the
/// metadata to be recorded in the manifest and uploaded (as a record) to the cloud.
pub fn generate_one(
    original: &Path,
    out_dir: &Path,
    max_edge: u32,
    jpeg_quality: u8,
) -> Result<PreviewResult, String> {
    let bytes = fs::read(original).map_err(|e| format!("read: {e}"))?;

    let content_hash = {
        let mut h = Sha256::new();
        h.update(&bytes);
        format!("{:x}", h.finalize())
    };

    let orientation = exif_orientation(&bytes);

    let decoded = ImageReader::new(Cursor::new(&bytes))
        .with_guessed_format()
        .map_err(|e| format!("format: {e}"))?
        .decode()
        .map_err(|e| format!("decode: {e}"))?;

    let img = apply_orientation(decoded, orientation);
    let thumb = img.thumbnail(max_edge, max_edge); // preserves aspect ratio, fast box filter
    let (width, height) = (thumb.width(), thumb.height());

    let uuid = Uuid::new_v4().to_string();
    let preview_name = format!("{uuid}.jpg");
    let preview_path = out_dir.join(&preview_name);

    let mut buf = Vec::new();
    thumb
        .to_rgb8()
        .write_with_encoder(image::codecs::jpeg::JpegEncoder::new_with_quality(
            &mut buf,
            jpeg_quality,
        ))
        .map_err(|e| format!("encode: {e}"))?;
    fs::write(&preview_path, &buf).map_err(|e| format!("write preview: {e}"))?;

    Ok(PreviewResult {
        uuid,
        original_filename: original
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string(),
        original_path: original.to_string_lossy().to_string(),
        content_hash,
        preview_path: preview_name,
        width,
        height,
    })
}

fn exif_orientation(bytes: &[u8]) -> u32 {
    let exif = exif::Reader::new().read_from_container(&mut Cursor::new(bytes));
    match exif {
        Ok(e) => e
            .get_field(exif::Tag::Orientation, exif::In::PRIMARY)
            .and_then(|f| f.value.get_uint(0))
            .unwrap_or(1),
        Err(_) => 1,
    }
}

fn apply_orientation(img: image::DynamicImage, orientation: u32) -> image::DynamicImage {
    match orientation {
        2 => img.fliph(),
        3 => img.rotate180(),
        4 => img.flipv(),
        5 => img.rotate90().fliph(),
        6 => img.rotate90(),
        7 => img.rotate270().fliph(),
        8 => img.rotate270(),
        _ => img,
    }
}
