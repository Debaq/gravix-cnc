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

/// Ajustes de tono aplicados antes del dithering. Sin ellos, una foto plana
/// o subexpuesta entra al kernel de difusion con casi todo el rango en una
/// sola mitad y sale como una mancha.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(default)]
pub struct ImageFilters {
    /// -100..100, desplazamiento lineal de luminancia
    pub brightness: f32,
    /// -100..100, expansion/compresion del rango alrededor de 128
    pub contrast: f32,
    /// 0.1..3.0, correccion de gamma (>1 aclara los medios tonos)
    pub gamma: f32,
    /// 0..100, cantidad de unsharp mask (0 = sin enfoque)
    pub sharpen: f32,
}

impl Default for ImageFilters {
    fn default() -> Self {
        Self { brightness: 0.0, contrast: 0.0, gamma: 1.0, sharpen: 0.0 }
    }
}

impl ImageFilters {
    fn is_identity(&self) -> bool {
        self.brightness == 0.0
            && self.contrast == 0.0
            && (self.gamma - 1.0).abs() < f32::EPSILON
            && self.sharpen == 0.0
    }
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
    filters: Option<ImageFilters>,
) -> Result<RasterResult, String> {
    tokio::task::spawn_blocking(move || {
        let img = image::open(Path::new(&path)).map_err(|e| format!("Error al cargar imagen: {}", e))?;
        process_image(img, width_mm, height_mm, dpi, dithering, threshold, invert, filters.unwrap_or_default())
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
    filters: Option<ImageFilters>,
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

    process_image(img, width_mm, height_mm, dpi, dithering, threshold, invert, filters.unwrap_or_default())
}

fn process_image(
    img: DynamicImage,
    width_mm: f64,
    height_mm: f64,
    dpi: f64,
    dithering: DitheringMode,
    threshold: u8,
    invert: bool,
    filters: ImageFilters,
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

    let resized = apply_filters(resized, filters);

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

/// Brillo, contraste y gamma son punto a punto: se resuelven en una LUT de 256
/// entradas y el barrido queda en un lookup por pixel. El enfoque no, porque
/// mira a los vecinos, asi que va despues sobre el resultado tonal.
pub fn apply_filters(img: GrayImage, filters: ImageFilters) -> GrayImage {
    if filters.is_identity() {
        return img;
    }

    let lut = tone_lut(filters);
    let (w, h) = img.dimensions();
    let mut out = GrayImage::from_fn(w, h, |x, y| Luma([lut[img.get_pixel(x, y).0[0] as usize]]));

    if filters.sharpen > 0.0 {
        out = unsharp_mask(&out, filters.sharpen / 100.0);
    }
    out
}

/// LUT de 256 entradas con gamma → brillo → contraste, en ese orden: la gamma
/// trabaja sobre los tonos originales y el contraste cierra estirando el
/// resultado alrededor del gris medio.
fn tone_lut(filters: ImageFilters) -> [u8; 256] {
    let gamma = filters.gamma.clamp(0.1, 3.0);
    let brightness = filters.brightness.clamp(-100.0, 100.0) * 2.55;
    // Formula clasica del factor de contraste, con c en -255..255
    let c = filters.contrast.clamp(-100.0, 100.0) * 2.55;
    let factor = (259.0 * (c + 255.0)) / (255.0 * (259.0 - c));

    let mut lut = [0u8; 256];
    for (i, entry) in lut.iter_mut().enumerate() {
        let mut v = i as f32 / 255.0;
        if (gamma - 1.0).abs() > f32::EPSILON {
            v = v.powf(1.0 / gamma);
        }
        let mut v = v * 255.0 + brightness;
        v = factor * (v - 128.0) + 128.0;
        *entry = v.clamp(0.0, 255.0) as u8;
    }
    lut
}

/// Unsharp mask: se resta un desenfoque gaussiano 3x3 y se devuelve la
/// diferencia amplificada. `amount` en 0..1 (la UI expone 0..100).
fn unsharp_mask(img: &GrayImage, amount: f32) -> GrayImage {
    #[rustfmt::skip]
    const GAUSS_3X3: [[f32; 3]; 3] = [
        [1.0, 2.0, 1.0],
        [2.0, 4.0, 2.0],
        [1.0, 2.0, 1.0],
    ];
    const GAUSS_SUM: f32 = 16.0;

    let (w, h) = img.dimensions();
    GrayImage::from_fn(w, h, |x, y| {
        let mut blur = 0.0;
        for (dy, row) in GAUSS_3X3.iter().enumerate() {
            for (dx, weight) in row.iter().enumerate() {
                // Los bordes replican el pixel del borde en vez de oscurecerse
                let sx = (x as i32 + dx as i32 - 1).clamp(0, w as i32 - 1) as u32;
                let sy = (y as i32 + dy as i32 - 1).clamp(0, h as i32 - 1) as u32;
                blur += img.get_pixel(sx, sy).0[0] as f32 * weight;
            }
        }
        blur /= GAUSS_SUM;

        let orig = img.get_pixel(x, y).0[0] as f32;
        Luma([(orig + amount * (orig - blur)).clamp(0.0, 255.0) as u8])
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn filters(brightness: f32, contrast: f32, gamma: f32, sharpen: f32) -> ImageFilters {
        ImageFilters { brightness, contrast, gamma, sharpen }
    }

    #[test]
    fn identity_lut_no_toca_los_tonos() {
        let lut = tone_lut(ImageFilters::default());
        for i in 0..256 {
            assert_eq!(lut[i], i as u8, "entrada {} cambio sin filtros", i);
        }
    }

    #[test]
    fn brillo_desplaza_y_satura_sin_envolver() {
        let lut = tone_lut(filters(50.0, 0.0, 1.0, 0.0));
        assert!(lut[100] > 100);
        assert_eq!(lut[255], 255, "el blanco satura, no vuelve a 0");

        let lut = tone_lut(filters(-50.0, 0.0, 1.0, 0.0));
        assert!(lut[100] < 100);
        assert_eq!(lut[0], 0);
    }

    #[test]
    fn contraste_separa_del_gris_medio() {
        let lut = tone_lut(filters(0.0, 60.0, 1.0, 0.0));
        assert!(lut[64] < 64, "las sombras se hunden");
        assert!(lut[192] > 192, "las luces suben");
        assert_eq!(lut[128], 128, "el punto medio es el pivote");

        let plano = tone_lut(filters(0.0, -60.0, 1.0, 0.0));
        assert!(plano[64] > 64 && plano[192] < 192, "contraste negativo comprime");
    }

    #[test]
    fn gamma_mayor_a_uno_aclara_los_medios() {
        let claro = tone_lut(filters(0.0, 0.0, 2.0, 0.0));
        let oscuro = tone_lut(filters(0.0, 0.0, 0.5, 0.0));
        assert!(claro[64] > 64);
        assert!(oscuro[64] < 64);
        // Los extremos son puntos fijos de la curva
        assert_eq!(claro[0], 0);
        assert_eq!(claro[255], 255);
    }

    #[test]
    fn unsharp_marca_el_borde_y_deja_el_plano_quieto() {
        // Mitad izquierda negra, mitad derecha blanca
        let img = GrayImage::from_fn(8, 4, |x, _| Luma([if x < 4 { 0 } else { 255 }]));
        let out = unsharp_mask(&img, 1.0);

        assert!(out.get_pixel(3, 2).0[0] == 0, "el lado oscuro del borde se hunde");
        assert!(out.get_pixel(4, 2).0[0] == 255, "el lado claro del borde se realza");
        assert_eq!(out.get_pixel(0, 2).0[0], 0, "zona plana intacta");
        assert_eq!(out.get_pixel(7, 2).0[0], 255, "zona plana intacta");
    }

    #[test]
    fn is_identity_solo_para_los_valores_neutros() {
        assert!(ImageFilters::default().is_identity());
        assert!(!filters(1.0, 0.0, 1.0, 0.0).is_identity());
        assert!(!filters(0.0, 0.0, 1.0, 5.0).is_identity());
        assert!(!filters(0.0, 0.0, 1.2, 0.0).is_identity());
    }
}
