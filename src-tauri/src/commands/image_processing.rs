use base64::{engine::general_purpose::STANDARD, Engine};
use image::{imageops::FilterType, DynamicImage, GrayImage, Luma};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Deserialize)]
pub enum DitheringMode {
    #[serde(rename = "threshold")]
    Threshold,
    #[serde(rename = "floydSteinberg")]
    FloydSteinberg,
    #[serde(rename = "ordered")]
    Ordered,
    #[serde(rename = "atkinson")]
    Atkinson,
    #[serde(rename = "jarvis")]
    Jarvis,
    #[serde(rename = "stucki")]
    Stucki,
    #[serde(rename = "burkes")]
    Burkes,
    #[serde(rename = "sierra")]
    Sierra,
    #[serde(rename = "grayscale")]
    Grayscale,
}

/// Resultado liviano — sin pixeles crudos, solo metadata + preview
#[derive(Debug, Serialize)]
pub struct RasterResult {
    pub width: u32,
    pub height: u32,
    pub pixel_size_mm: f64,
    /// Preview PNG en base64
    pub preview_base64: String,
    /// Path al archivo temporal con los pixeles crudos (1 byte por pixel)
    pub pixels_path: String,
}

#[tauri::command]
pub async fn process_image_for_laser(
    path: String,
    width_mm: f64,
    height_mm: f64,
    dpi: f64,
    dithering: DitheringMode,
    threshold: u8,
    invert: bool,
) -> Result<RasterResult, String> {
    tokio::task::spawn_blocking(move || {
        let img = image::open(Path::new(&path)).map_err(|e| format!("Error al cargar imagen: {}", e))?;
        process_image(img, width_mm, height_mm, dpi, dithering, threshold, invert)
    })
    .await
    .map_err(|e| format!("Error en thread: {}", e))?
}

#[tauri::command]
pub async fn process_image_base64_for_laser(
    image_base64: String,
    width_mm: f64,
    height_mm: f64,
    dpi: f64,
    dithering: DitheringMode,
    threshold: u8,
    invert: bool,
) -> Result<RasterResult, String> {
    tokio::task::spawn_blocking(move || {
        let b64_data = if let Some(pos) = image_base64.find(",") {
            &image_base64[pos + 1..]
        } else {
            &image_base64
        };

        let bytes = STANDARD
            .decode(b64_data)
            .map_err(|e| format!("Error decodificando base64: {}", e))?;

        let img = image::load_from_memory(&bytes)
            .map_err(|e| format!("Error al cargar imagen desde bytes: {}", e))?;

        process_image(img, width_mm, height_mm, dpi, dithering, threshold, invert)
    })
    .await
    .map_err(|e| format!("Error en thread: {}", e))?
}

/// Lee los pixeles crudos desde el archivo temporal
#[tauri::command]
pub fn read_raster_pixels(pixels_path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&pixels_path).map_err(|e| format!("Error leyendo pixeles: {}", e))
}

/// Función pública para procesar imagen desde base64 (usada por web_server)
pub fn process_image_base64(
    image_base64: &str,
    width_mm: f64,
    height_mm: f64,
    dpi: f64,
    dithering: DitheringMode,
    threshold: u8,
    invert: bool,
) -> Result<RasterResult, String> {
    let b64_data = if let Some(pos) = image_base64.find(",") {
        &image_base64[pos + 1..]
    } else {
        image_base64
    };

    let bytes = STANDARD
        .decode(b64_data)
        .map_err(|e| format!("Error decodificando base64: {}", e))?;

    let img = image::load_from_memory(&bytes)
        .map_err(|e| format!("Error al cargar imagen desde bytes: {}", e))?;

    process_image(img, width_mm, height_mm, dpi, dithering, threshold, invert)
}

fn process_image(
    img: DynamicImage,
    width_mm: f64,
    height_mm: f64,
    dpi: f64,
    dithering: DitheringMode,
    threshold: u8,
    invert: bool,
) -> Result<RasterResult, String> {
    let pixel_size_mm = 25.4 / dpi;

    let img_w = img.width() as f64;
    let img_h = img.height() as f64;
    let aspect = img_w / img_h;

    let (fit_w_mm, fit_h_mm) = {
        let w = width_mm;
        let h = w / aspect;
        if h <= height_mm {
            (w, h)
        } else {
            let h = height_mm;
            let w = h * aspect;
            (w, h)
        }
    };

    let target_w = (fit_w_mm / pixel_size_mm).round() as u32;
    let target_h = (fit_h_mm / pixel_size_mm).round() as u32;

    if target_w == 0 || target_h == 0 {
        return Err("Dimensiones resultantes son 0 pixeles".into());
    }
    if target_w > 10000 || target_h > 10000 {
        return Err(format!(
            "Dimensiones demasiado grandes: {}x{} px. Reduce DPI o tamaño.",
            target_w, target_h
        ));
    }

    let gray = img.grayscale();
    let resized = image::imageops::resize(
        &gray.to_luma8(),
        target_w,
        target_h,
        FilterType::Lanczos3,
    );

    let mut buffer: GrayImage = if invert {
        GrayImage::from_fn(target_w, target_h, |x, y| {
            Luma([255 - resized.get_pixel(x, y).0[0]])
        })
    } else {
        resized
    };

    match dithering {
        DitheringMode::Threshold => apply_threshold(&mut buffer, threshold),
        DitheringMode::FloydSteinberg => apply_floyd_steinberg(&mut buffer, threshold),
        DitheringMode::Ordered => apply_ordered_dither(&mut buffer),
        DitheringMode::Atkinson => apply_atkinson(&mut buffer, threshold),
        DitheringMode::Jarvis => diffuse_error(&mut buffer, threshold, JARVIS, 48.0),
        DitheringMode::Stucki => diffuse_error(&mut buffer, threshold, STUCKI, 42.0),
        DitheringMode::Burkes => diffuse_error(&mut buffer, threshold, BURKES, 32.0),
        DitheringMode::Sierra => diffuse_error(&mut buffer, threshold, SIERRA, 32.0),
        DitheringMode::Grayscale => {}
    }

    let pixels: Vec<u8> = buffer.pixels().map(|p| p.0[0]).collect();

    // Guardar pixeles en archivo temporal (binario crudo, no JSON)
    let tmp_path = std::env::temp_dir().join("grbl_raster_pixels.bin");
    std::fs::write(&tmp_path, &pixels)
        .map_err(|e| format!("Error guardando pixeles: {}", e))?;

    // Preview: escalar a max 400px para que sea liviana
    let preview_max = 400u32;
    let (pw, ph) = if target_w > preview_max || target_h > preview_max {
        let scale = preview_max as f64 / target_w.max(target_h) as f64;
        ((target_w as f64 * scale) as u32, (target_h as f64 * scale) as u32)
    } else {
        (target_w, target_h)
    };
    let preview_img = image::imageops::resize(&buffer, pw, ph, FilterType::Nearest);
    let preview_pixels: Vec<u8> = preview_img.pixels().map(|p| p.0[0]).collect();

    let mut png_bytes: Vec<u8> = Vec::new();
    let encoder = image::codecs::png::PngEncoder::new(&mut png_bytes);
    image::ImageEncoder::write_image(
        encoder,
        &preview_pixels,
        pw,
        ph,
        image::ExtendedColorType::L8,
    )
    .map_err(|e| format!("Error al generar preview: {}", e))?;

    let preview_base64 = format!("data:image/png;base64,{}", STANDARD.encode(&png_bytes));

    Ok(RasterResult {
        width: target_w,
        height: target_h,
        pixels_path: tmp_path.to_string_lossy().to_string(),
        pixel_size_mm,
        preview_base64,
    })
}

/// Un peso del kernel: desplazamiento (dx, dy) respecto al pixel actual y su
/// numerador. El divisor va aparte para no repetirlo en cada entrada.
type DiffusionKernel = &'static [(i32, i32, f32)];

#[rustfmt::skip]
const JARVIS: DiffusionKernel = &[
    (1, 0, 7.0), (2, 0, 5.0),
    (-2, 1, 3.0), (-1, 1, 5.0), (0, 1, 7.0), (1, 1, 5.0), (2, 1, 3.0),
    (-2, 2, 1.0), (-1, 2, 3.0), (0, 2, 5.0), (1, 2, 3.0), (2, 2, 1.0),
];

#[rustfmt::skip]
const STUCKI: DiffusionKernel = &[
    (1, 0, 8.0), (2, 0, 4.0),
    (-2, 1, 2.0), (-1, 1, 4.0), (0, 1, 8.0), (1, 1, 4.0), (2, 1, 2.0),
    (-2, 2, 1.0), (-1, 2, 2.0), (0, 2, 4.0), (1, 2, 2.0), (2, 2, 1.0),
];

#[rustfmt::skip]
const BURKES: DiffusionKernel = &[
    (1, 0, 8.0), (2, 0, 4.0),
    (-2, 1, 2.0), (-1, 1, 4.0), (0, 1, 8.0), (1, 1, 4.0), (2, 1, 2.0),
];

/// Sierra "de tres lineas", el clasico.
#[rustfmt::skip]
const SIERRA: DiffusionKernel = &[
    (1, 0, 5.0), (2, 0, 3.0),
    (-2, 1, 2.0), (-1, 1, 4.0), (0, 1, 5.0), (1, 1, 4.0), (2, 1, 2.0),
    (-1, 2, 2.0), (0, 2, 3.0), (1, 2, 2.0),
];

/// Difusion de error generica. Floyd-Steinberg y Atkinson tienen su propia
/// funcion por razones historicas; todo kernel nuevo entra por aca.
fn diffuse_error(img: &mut GrayImage, threshold: u8, kernel: DiffusionKernel, divisor: f32) {
    let (w, h) = img.dimensions();
    let mut buf: Vec<Vec<f32>> = (0..h)
        .map(|y| (0..w).map(|x| img.get_pixel(x, y).0[0] as f32).collect())
        .collect();

    for y in 0..h as i32 {
        for x in 0..w as i32 {
            let old = buf[y as usize][x as usize];
            let new_val: f32 = if old > threshold as f32 { 255.0 } else { 0.0 };
            let error = (old - new_val) / divisor;
            buf[y as usize][x as usize] = new_val;

            for &(dx, dy, weight) in kernel {
                let nx = x + dx;
                let ny = y + dy;
                if nx < 0 || ny < 0 || nx >= w as i32 || ny >= h as i32 {
                    continue;
                }
                buf[ny as usize][nx as usize] += error * weight;
            }
        }
    }

    for y in 0..h {
        for x in 0..w {
            let v = buf[y as usize][x as usize].clamp(0.0, 255.0) as u8;
            img.put_pixel(x, y, Luma([v]));
        }
    }
}

fn apply_threshold(img: &mut GrayImage, threshold: u8) {
    for pixel in img.pixels_mut() {
        pixel.0[0] = if pixel.0[0] > threshold { 255 } else { 0 };
    }
}

fn apply_floyd_steinberg(img: &mut GrayImage, threshold: u8) {
    let (w, h) = img.dimensions();
    let mut buf: Vec<Vec<f32>> = (0..h)
        .map(|y| (0..w).map(|x| img.get_pixel(x, y).0[0] as f32).collect())
        .collect();

    for y in 0..h {
        for x in 0..w {
            let old = buf[y as usize][x as usize];
            let new_val: f32 = if old > threshold as f32 { 255.0 } else { 0.0 };
            let error = old - new_val;
            buf[y as usize][x as usize] = new_val;

            if x + 1 < w {
                buf[y as usize][(x + 1) as usize] += error * 7.0 / 16.0;
            }
            if y + 1 < h {
                if x > 0 {
                    buf[(y + 1) as usize][(x - 1) as usize] += error * 3.0 / 16.0;
                }
                buf[(y + 1) as usize][x as usize] += error * 5.0 / 16.0;
                if x + 1 < w {
                    buf[(y + 1) as usize][(x + 1) as usize] += error * 1.0 / 16.0;
                }
            }
        }
    }

    for y in 0..h {
        for x in 0..w {
            let v = buf[y as usize][x as usize].clamp(0.0, 255.0) as u8;
            img.put_pixel(x, y, Luma([v]));
        }
    }
}

fn apply_ordered_dither(img: &mut GrayImage) {
    #[rustfmt::skip]
    const BAYER_4X4: [[f32; 4]; 4] = [
        [ 0.0/16.0,  8.0/16.0,  2.0/16.0, 10.0/16.0],
        [12.0/16.0,  4.0/16.0, 14.0/16.0,  6.0/16.0],
        [ 3.0/16.0, 11.0/16.0,  1.0/16.0,  9.0/16.0],
        [15.0/16.0,  7.0/16.0, 13.0/16.0,  5.0/16.0],
    ];

    let (w, h) = img.dimensions();
    for y in 0..h {
        for x in 0..w {
            let old = img.get_pixel(x, y).0[0] as f32 / 255.0;
            let threshold = BAYER_4X4[(y % 4) as usize][(x % 4) as usize];
            let new_val: u8 = if old > threshold { 255 } else { 0 };
            img.put_pixel(x, y, Luma([new_val]));
        }
    }
}

fn apply_atkinson(img: &mut GrayImage, threshold: u8) {
    let (w, h) = img.dimensions();
    let mut buf: Vec<Vec<f32>> = (0..h)
        .map(|y| (0..w).map(|x| img.get_pixel(x, y).0[0] as f32).collect())
        .collect();

    for y in 0..h {
        for x in 0..w {
            let old = buf[y as usize][x as usize];
            let new_val: f32 = if old > threshold as f32 { 255.0 } else { 0.0 };
            let error = (old - new_val) / 8.0;
            buf[y as usize][x as usize] = new_val;

            let yi = y as usize;
            let xi = x as usize;

            if x + 1 < w { buf[yi][xi + 1] += error; }
            if x + 2 < w { buf[yi][xi + 2] += error; }
            if y + 1 < h {
                if x > 0 { buf[yi + 1][xi - 1] += error; }
                buf[yi + 1][xi] += error;
                if x + 1 < w { buf[yi + 1][xi + 1] += error; }
            }
            if y + 2 < h { buf[yi + 2][xi] += error; }
        }
    }

    for y in 0..h {
        for x in 0..w {
            let v = buf[y as usize][x as usize].clamp(0.0, 255.0) as u8;
            img.put_pixel(x, y, Luma([v]));
        }
    }
}
