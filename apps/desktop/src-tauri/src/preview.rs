//! Preview generation engine. Scans a folder of high-res originals and produces small JPEG
//! previews in parallel (rayon), honoring EXIF orientation, while computing a content hash and
//! assigning each photo a stable UUID. Originals are never modified or moved.

use image::ImageReader;
use rayon::prelude::*;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use uuid::Uuid;
use walkdir::WalkDir;

const SUPPORTED: &[&str] = &["jpg", "jpeg", "png", "tif", "tiff", "webp", "heic"];

/// Camera RAW formats. We don't demosaic these — instead we extract the full-size JPEG preview
/// that cameras embed inside the RAW (fast, no heavy RAW pipeline), which is exactly what a
/// selection preview needs. Covers the common Canon/Nikon/Sony/Fuji/Panasonic/Adobe formats.
const RAW_EXTS: &[&str] = &["cr2", "cr3", "nef", "arw", "dng", "raf", "rw2", "orf"];

static WATERMARK_FONT: &[u8] = include_bytes!("../assets/DejaVuSans.ttf");

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
                .map(|x| {
                    let e = x.to_lowercase();
                    SUPPORTED.contains(&e.as_str()) || RAW_EXTS.contains(&e.as_str())
                })
                .unwrap_or(false)
        })
        .collect()
}

fn is_raw(path: &Path) -> bool {
    path.extension()
        .and_then(|x| x.to_str())
        .map(|x| RAW_EXTS.contains(&x.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// Generate a single preview. `max_edge` is the longest-side target (e.g. 1600px). `watermark`,
/// if set, tiles semi-transparent text across the preview. Returns the metadata to be recorded in
/// the manifest and uploaded (as a record) to the cloud.
pub fn generate_one(
    original: &Path,
    out_dir: &Path,
    max_edge: u32,
    jpeg_quality: u8,
    watermark: Option<&str>,
) -> Result<PreviewResult, String> {
    let bytes = fs::read(original).map_err(|e| format!("read: {e}"))?;

    let content_hash = {
        let mut h = Sha256::new();
        h.update(&bytes);
        format!("{:x}", h.finalize())
    };

    // For RAW files, decode the embedded full-size JPEG preview rather than the raw sensor data.
    let decode_bytes: std::borrow::Cow<[u8]> = if is_raw(original) {
        match extract_embedded_jpeg(&bytes) {
            Some(jpeg) => std::borrow::Cow::Owned(jpeg),
            None => return Err(format!("{}: no embedded preview in RAW", display_name(original))),
        }
    } else {
        std::borrow::Cow::Borrowed(&bytes)
    };

    let orientation = exif_orientation(&decode_bytes);

    let decoded = ImageReader::new(Cursor::new(decode_bytes.as_ref()))
        .with_guessed_format()
        .map_err(|e| format!("format: {e}"))?
        .decode()
        .map_err(|e| format!("decode: {e}"))?;

    let img = apply_orientation(decoded, orientation);
    // Triangle (bilinear) downscale: for the large downscale ratios typical here (e.g.
    // 12MP → 1600px) it is markedly faster than Lanczos3 while remaining visually crisp for
    // previews clients select from. Aspect ratio preserved within max_edge.
    let thumb = img.resize(max_edge, max_edge, image::imageops::FilterType::Triangle);
    let (width, height) = (thumb.width(), thumb.height());

    // Encode, optionally watermarked.
    let rgb = match watermark {
        Some(text) if !text.is_empty() => {
            let mut rgba = thumb.to_rgba8();
            apply_watermark(&mut rgba, text);
            image::DynamicImage::ImageRgba8(rgba).to_rgb8()
        }
        _ => thumb.to_rgb8(),
    };

    let uuid = Uuid::new_v4().to_string();
    let preview_name = format!("{uuid}.jpg");
    let preview_path = out_dir.join(&preview_name);

    let mut buf = Vec::new();
    rgb.write_with_encoder(image::codecs::jpeg::JpegEncoder::new_with_quality(
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

/// Generate previews for many originals in parallel across CPU cores (rayon).
/// `on_progress(done, total, filename)` fires as each completes. This is deliberately decoupled
/// from Tauri so it can be unit-tested and benchmarked headlessly; the Tauri command wraps it
/// with a closure that emits progress events to the UI.
pub fn generate_batch<F>(
    images: &[PathBuf],
    out_dir: &Path,
    max_edge: u32,
    jpeg_quality: u8,
    watermark: Option<&str>,
    on_progress: F,
) -> (Vec<PreviewResult>, Vec<String>)
where
    F: Fn(usize, usize, &str) + Sync + Send,
{
    let total = images.len();
    let counter = AtomicUsize::new(0);

    let results: Vec<Result<PreviewResult, String>> = images
        .par_iter()
        .map(|path| {
            let r = generate_one(path, out_dir, max_edge, jpeg_quality, watermark);
            let done = counter.fetch_add(1, Ordering::SeqCst) + 1;
            on_progress(
                done,
                total,
                path.file_name().and_then(|n| n.to_str()).unwrap_or(""),
            );
            r
        })
        .collect();

    let mut ok = Vec::new();
    let mut errs = Vec::new();
    for r in results {
        match r {
            Ok(p) => ok.push(p),
            Err(e) => errs.push(e),
        }
    }
    (ok, errs)
}

fn display_name(p: &Path) -> &str {
    p.file_name().and_then(|n| n.to_str()).unwrap_or("unknown")
}

/// Extract the largest embedded JPEG (SOI..EOI) from a container such as a camera RAW. Cameras
/// embed a full-size JPEG preview; the largest decodable one is what we want. We pick the largest
/// candidate that actually decodes, so a stray 0xFFD9 inside compressed data can't fool us.
fn extract_embedded_jpeg(bytes: &[u8]) -> Option<Vec<u8>> {
    // Collect candidate (start, end) spans bounded by SOI (FF D8 FF) and EOI (FF D9).
    let mut candidates: Vec<(usize, usize)> = Vec::new();
    let mut i = 0usize;
    while i + 2 < bytes.len() {
        if bytes[i] == 0xFF && bytes[i + 1] == 0xD8 && bytes[i + 2] == 0xFF {
            let start = i;
            let mut j = i + 2;
            let mut end = None;
            while j + 1 < bytes.len() {
                if bytes[j] == 0xFF && bytes[j + 1] == 0xD9 {
                    end = Some(j + 2);
                    break;
                }
                j += 1;
            }
            if let Some(e) = end {
                candidates.push((start, e));
                i = e;
                continue;
            }
        }
        i += 1;
    }
    // Largest span first; return the first that decodes as a real image.
    candidates.sort_by_key(|(s, e)| std::cmp::Reverse(e - s));
    for (s, e) in candidates {
        let slice = &bytes[s..e];
        if image::ImageReader::new(Cursor::new(slice))
            .with_guessed_format()
            .ok()
            .and_then(|r| r.decode().ok())
            .is_some()
        {
            return Some(slice.to_vec());
        }
    }
    None
}

/// Tile semi-transparent text across the image to deter clients reusing previews without paying.
fn apply_watermark(img: &mut image::RgbaImage, text: &str) {
    let font = match ab_glyph::FontRef::try_from_slice(WATERMARK_FONT) {
        Ok(f) => f,
        Err(_) => return,
    };
    let (w, h) = (img.width(), img.height());
    let scale = ab_glyph::PxScale::from((w as f32 / 16.0).clamp(16.0, 64.0));

    // Render onto a transparent layer, then composite white at low opacity for a subtle mark.
    let mut layer = image::RgbaImage::new(w, h);
    let step_x = (w as f32 * 0.5).max(120.0) as i32;
    let step_y = (h as f32 * 0.25).max(80.0) as i32;
    let mut y = 0i32;
    let mut row = 0;
    while y < h as i32 {
        let offset = if row % 2 == 0 { 0 } else { step_x / 2 };
        let mut x = -step_x + offset;
        while x < w as i32 {
            imageproc::drawing::draw_text_mut(
                &mut layer,
                image::Rgba([255, 255, 255, 255]),
                x,
                y,
                scale,
                &font,
                text,
            );
            x += step_x;
        }
        y += step_y;
        row += 1;
    }

    let opacity = 0.22_f32;
    for (base_px, layer_px) in img.pixels_mut().zip(layer.pixels()) {
        let a = (layer_px[3] as f32 / 255.0) * opacity;
        if a > 0.0 {
            for c in 0..3 {
                base_px[c] = ((1.0 - a) * base_px[c] as f32 + a * 255.0) as u8;
            }
        }
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, RgbImage};

    /// Write a solid-color JPEG of the given size into `dir`, return its path.
    fn write_jpeg(dir: &Path, name: &str, w: u32, h: u32) -> PathBuf {
        let img = DynamicImage::ImageRgb8(RgbImage::from_pixel(w, h, image::Rgb([120, 60, 30])));
        let path = dir.join(name);
        img.save_with_format(&path, image::ImageFormat::Jpeg).unwrap();
        path
    }

    fn tmpdir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("pb-prev-{tag}-{}", Uuid::new_v4()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn generates_a_smaller_preview_within_max_edge() {
        let dir = tmpdir("gen");
        let out = dir.join("out");
        fs::create_dir_all(&out).unwrap();
        let original = write_jpeg(&dir, "IMG_9.jpg", 4000, 3000);
        let orig_size = fs::metadata(&original).unwrap().len();

        let r = generate_one(&original, &out, 1600, 80, None).unwrap();

        assert_eq!(r.original_filename, "IMG_9.jpg");
        assert!(!r.content_hash.is_empty());
        assert!(Uuid::parse_str(&r.uuid).is_ok());
        // longest edge respected, aspect ratio preserved (4:3)
        assert_eq!(r.width, 1600);
        assert_eq!(r.height, 1200);
        let preview = out.join(&r.preview_path);
        assert!(preview.exists());
        assert!(fs::metadata(&preview).unwrap().len() < orig_size, "preview should be smaller");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn watermark_alters_pixels_and_stays_decodable() {
        let dir = tmpdir("wm");
        let out = dir.join("out");
        fs::create_dir_all(&out).unwrap();
        let original = write_jpeg(&dir, "IMG_W.jpg", 1600, 1200);

        let plain = generate_one(&original, &out, 800, 85, None).unwrap();
        let marked = generate_one(&original, &out, 800, 85, Some("PREVIEW · DEMO STUDIO")).unwrap();

        let plain_bytes = fs::read(out.join(&plain.preview_path)).unwrap();
        let marked_bytes = fs::read(out.join(&marked.preview_path)).unwrap();
        assert_ne!(plain_bytes, marked_bytes, "watermark should change the output");
        // The watermarked preview must still be a valid, decodable JPEG.
        assert!(image::load_from_memory(&marked_bytes).is_ok());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn extracts_largest_embedded_jpeg_from_raw_container() {
        let dir = tmpdir("raw");
        // Build a fake RAW: TIFF-ish header + a tiny embedded JPEG + a larger embedded JPEG.
        let small = fs::read(write_jpeg(&dir, "small.jpg", 80, 60)).unwrap();
        let large = fs::read(write_jpeg(&dir, "large.jpg", 1024, 768)).unwrap();
        let mut raw = vec![0x49, 0x49, 0x2A, 0x00, 1, 2, 3, 4]; // "II*\0" TIFF magic + filler
        raw.extend_from_slice(&small);
        raw.extend_from_slice(&[0u8; 16]);
        raw.extend_from_slice(&large);
        raw.extend_from_slice(&[9u8; 8]);

        let extracted = extract_embedded_jpeg(&raw).expect("should find an embedded jpeg");
        let img = image::load_from_memory(&extracted).expect("extracted jpeg decodes");
        // It should pick the LARGER preview (1024x768), not the small thumbnail.
        assert_eq!((img.width(), img.height()), (1024, 768));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn orientation_6_rotates_portrait() {
        // EXIF orientation 6 = rotate 90°: a 200x100 landscape becomes 100x200.
        let landscape = DynamicImage::ImageRgb8(RgbImage::new(200, 100));
        let rotated = apply_orientation(landscape, 6);
        assert_eq!((rotated.width(), rotated.height()), (100, 200));
    }

    #[test]
    fn list_images_filters_unsupported_files() {
        let dir = tmpdir("list");
        write_jpeg(&dir, "a.jpg", 50, 50);
        fs::write(dir.join("notes.txt"), b"hi").unwrap();
        fs::write(dir.join("b.JPG"), fs::read(dir.join("a.jpg")).unwrap()).unwrap();
        let imgs = list_images(&dir);
        assert_eq!(imgs.len(), 2); // a.jpg + b.JPG (case-insensitive), not notes.txt
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn batch_generates_all_and_reports_failures() {
        let dir = tmpdir("batch");
        let out = dir.join("out");
        fs::create_dir_all(&out).unwrap();
        let mut imgs: Vec<PathBuf> = (0..5)
            .map(|i| write_jpeg(&dir, &format!("p{i}.jpg"), 1200, 800))
            .collect();
        // a bogus "image" that will fail to decode
        let bad = dir.join("bad.jpg");
        fs::write(&bad, b"not an image").unwrap();
        imgs.push(bad);

        let seen = std::sync::atomic::AtomicUsize::new(0);
        let (ok, errs) = generate_batch(&imgs, &out, 600, 75, None, |_d, _t, _c| {
            seen.fetch_add(1, Ordering::SeqCst);
        });

        assert_eq!(ok.len(), 5);
        assert_eq!(errs.len(), 1);
        assert_eq!(seen.load(Ordering::SeqCst), 6); // progress fired for every item
        fs::remove_dir_all(&dir).ok();
    }

    /// Benchmark — run with: `cargo test bench_throughput -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn bench_throughput() {
        let dir = tmpdir("bench");
        let out = dir.join("out");
        fs::create_dir_all(&out).unwrap();
        const N: usize = 200;
        let imgs: Vec<PathBuf> = (0..N)
            .map(|i| write_jpeg(&dir, &format!("b{i}.jpg"), 4000, 3000)) // ~12MP
            .collect();

        let start = std::time::Instant::now();
        let (ok, errs) = generate_batch(&imgs, &out, 1600, 80, None, |_d, _t, _c| {});
        let elapsed = start.elapsed();

        assert_eq!(ok.len(), N);
        assert!(errs.is_empty());
        let per = elapsed.as_secs_f64() / N as f64;
        println!(
            "BENCH: {N} previews (12MP→1600px Triangle) in {:.2}s = {:.1}/s, {:.1}ms each, ~{:.0}s for 1000",
            elapsed.as_secs_f64(),
            N as f64 / elapsed.as_secs_f64(),
            per * 1000.0,
            per * 1000.0,
        );
        fs::remove_dir_all(&dir).ok();
    }
}
