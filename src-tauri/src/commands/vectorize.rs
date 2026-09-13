//! Auto-vectorizacion: bitmap -> contornos -> SVG.
//!
//! El trazado va por marching squares sobre la imagen binarizada. La
//! alternativa habitual (seguir el borde pixel a pixel con Moore) obliga a
//! etiquetar componentes antes para saber que es agujero y que es pieza; aca
//! los agujeros salen solos, porque marching squares les da el sentido de giro
//! contrario al del contorno que los contiene.

use base64::{engine::general_purpose::STANDARD, Engine};
use image::{imageops::FilterType, DynamicImage, GrayImage};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt::Write as _;
use std::path::Path;

use super::image_processing::ImageFilters;

/// Que contornos entran al SVG final.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
pub enum TraceMode {
    /// Solo el contorno exterior de cada mancha: la silueta, sin agujeros ni
    /// detalle interno. Es lo que se quiere para cortar una figura entera.
    #[serde(rename = "silhouette")]
    Silhouette,
    /// Contorno exterior + agujeros, como subpaths del mismo path.
    #[serde(rename = "outline")]
    Outline,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceOptions {
    pub mode: TraceMode,
    /// Umbral de binarizacion (0-255). Un pixel es tinta si su gris es <= umbral
    pub threshold: u8,
    /// Invierte que se considera tinta (para fondos oscuros)
    pub invert: bool,
    /// Descarta manchas y agujeros de menos de N pixeles de area
    pub min_area: u32,
    /// Tolerancia de Douglas-Peucker en pixeles (0 = conservar la escalera)
    pub simplify: f64,
    /// 0..1, cuanto se curvan los tramos. 0 = polilineas rectas
    pub smooth: f64,
    /// La imagen se reduce hasta este lado maximo antes de trazar
    pub max_resolution: u32,
}

impl Default for TraceOptions {
    fn default() -> Self {
        Self {
            mode: TraceMode::Outline,
            threshold: 128,
            invert: false,
            min_area: 16,
            simplify: 1.0,
            smooth: 0.6,
            max_resolution: 1200,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct TraceResult {
    /// SVG completo, en mm, listo para entrar al lienzo
    pub svg: String,
    /// Vista previa del SVG como data URI (el mismo SVG, en base64)
    pub preview_base64: String,
    /// Contornos exteriores conservados
    pub path_count: usize,
    /// Agujeros conservados (0 en modo silueta)
    pub hole_count: usize,
    /// Nodos totales del resultado — sirve para avisar que el trazado es pesado
    pub point_count: usize,
    pub width_mm: f64,
    pub height_mm: f64,
    /// Resolucion a la que se trazo, despues del downscale
    pub traced_width: u32,
    pub traced_height: u32,
}

#[tauri::command]
pub async fn trace_image_to_svg(
    path: String,
    width_mm: f64,
    height_mm: f64,
    options: TraceOptions,
    filters: Option<ImageFilters>,
) -> Result<TraceResult, String> {
    tokio::task::spawn_blocking(move || {
        let img = image::open(Path::new(&path))
            .map_err(|e| format!("Error al cargar imagen: {}", e))?;
        trace_image(img, width_mm, height_mm, options, filters.unwrap_or_default())
    })
    .await
    .map_err(|e| format!("Error en thread: {}", e))?
}

pub fn trace_image(
    img: DynamicImage,
    width_mm: f64,
    height_mm: f64,
    options: TraceOptions,
    filters: ImageFilters,
) -> Result<TraceResult, String> {
    let gray = to_working_gray(img, options.max_resolution, filters);
    let (w, h) = gray.dimensions();
    if w < 2 || h < 2 {
        return Err("La imagen es demasiado chica para vectorizar".into());
    }

    let mask = binarize(&gray, options.threshold, options.invert);
    let loops = march_squares(&mask, w as usize, h as usize);

    let (outers, holes) = classify_loops(loops, options.min_area as f64);
    if outers.is_empty() {
        return Err(
            "No se encontro ningun contorno. Prueba con otro umbral o invirtiendo la imagen".into(),
        );
    }

    let holes = if options.mode == TraceMode::Silhouette {
        Vec::new()
    } else {
        holes
    };

    // Cada agujero cuelga del contorno mas chico que lo contiene: si ese
    // contorno se descarto por tamaño, el agujero se va con el
    let mut children: Vec<Vec<Contour>> = vec![Vec::new(); outers.len()];
    let mut hole_count = 0;
    for hole in holes {
        if let Some(idx) = smallest_container(&outers, &hole) {
            children[idx].push(hole);
            hole_count += 1;
        }
    }

    // El escalado mantiene la proporcion dentro del area util
    let aspect = w as f64 / h as f64;
    let (out_w_mm, out_h_mm) = if width_mm / aspect <= height_mm {
        (width_mm, width_mm / aspect)
    } else {
        (height_mm * aspect, height_mm)
    };
    let scale = out_w_mm / w as f64;

    let mut d_paths = Vec::with_capacity(outers.len());
    let mut point_count = 0;
    for (outer, holes) in outers.iter().zip(children.iter()) {
        let mut d = String::new();
        for contour in std::iter::once(outer).chain(holes.iter()) {
            let simplified = simplify_closed(contour, options.simplify);
            if simplified.len() < 3 {
                continue;
            }
            point_count += simplified.len();
            let scaled: Vec<[f64; 2]> = simplified
                .iter()
                .map(|p| [p[0] * scale, p[1] * scale])
                .collect();
            if !d.is_empty() {
                d.push(' ');
            }
            d.push_str(&contour_to_d(&scaled, options.smooth));
        }
        if !d.is_empty() {
            d_paths.push(d);
        }
    }

    if d_paths.is_empty() {
        return Err("Los contornos quedaron vacios tras simplificar. Baja la simplificacion".into());
    }

    let svg = build_svg(&d_paths, out_w_mm, out_h_mm);
    let preview_base64 = format!("data:image/svg+xml;base64,{}", STANDARD.encode(svg.as_bytes()));

    Ok(TraceResult {
        svg,
        preview_base64,
        path_count: d_paths.len(),
        hole_count,
        point_count,
        width_mm: out_w_mm,
        height_mm: out_h_mm,
        traced_width: w,
        traced_height: h,
    })
}

/// Gris + downscale + filtros de tono. El downscale va antes de los filtros
/// para que el enfoque trabaje sobre los pixeles que de verdad se van a trazar.
fn to_working_gray(img: DynamicImage, max_resolution: u32, filters: ImageFilters) -> GrayImage {
    let gray = img.grayscale().to_luma8();
    let (w, h) = gray.dimensions();
    let max_side = w.max(h);

    let gray = if max_resolution > 0 && max_side > max_resolution {
        let scale = max_resolution as f64 / max_side as f64;
        let nw = ((w as f64 * scale).round() as u32).max(2);
        let nh = ((h as f64 * scale).round() as u32).max(2);
        image::imageops::resize(&gray, nw, nh, FilterType::Lanczos3)
    } else {
        gray
    };

    super::image_processing::apply_filters(gray, filters)
}

/// true = tinta. Sin invertir, la tinta es lo oscuro.
fn binarize(img: &GrayImage, threshold: u8, invert: bool) -> Vec<bool> {
    img.pixels()
        .map(|p| {
            let ink = p.0[0] <= threshold;
            if invert {
                !ink
            } else {
                ink
            }
        })
        .collect()
}

/// Clave de un punto del contorno en coordenadas dobles (medios pixeles), para
/// poder encadenar segmentos comparando enteros y no floats.
type PtKey = (i32, i32);

/// Contorno cerrado en coordenadas de pixel.
type Contour = Vec<[f64; 2]>;

/// Marching squares con la imagen rodeada de un borde de fondo, asi ningun
/// contorno queda abierto contra el limite. Devuelve loops cerrados en
/// coordenadas de pixel.
fn march_squares(mask: &[bool], w: usize, h: usize) -> Vec<Contour> {
    // Rejilla con marco: (w+2) x (h+2). El pixel (x,y) original vive en (x+1,y+1)
    let gw = w + 2;
    let gh = h + 2;
    let at = |x: usize, y: usize| -> bool {
        if x == 0 || y == 0 || x > w || y > h {
            false
        } else {
            mask[(y - 1) * w + (x - 1)]
        }
    };

    // Cada punto de salida apunta al de llegada. Los casos ambiguos (5 y 10)
    // meten dos segmentos, por eso el valor es una lista corta.
    let mut links: HashMap<PtKey, Vec<PtKey>> = HashMap::new();
    let push = |from: PtKey, to: PtKey, links: &mut HashMap<PtKey, Vec<PtKey>>| {
        links.entry(from).or_default().push(to);
    };

    for j in 0..gh - 1 {
        for i in 0..gw - 1 {
            let tl = at(i, j);
            let tr = at(i + 1, j);
            let br = at(i + 1, j + 1);
            let bl = at(i, j + 1);

            let case = (tl as u8) | ((tr as u8) << 1) | ((br as u8) << 2) | ((bl as u8) << 3);
            if case == 0 || case == 15 {
                continue;
            }

            let i2 = (i as i32) * 2;
            let j2 = (j as i32) * 2;
            let top = (i2 + 1, j2);
            let right = (i2 + 2, j2 + 1);
            let bottom = (i2 + 1, j2 + 2);
            let left = (i2, j2 + 1);

            // Tabla orientada de modo que la tinta queda a la izquierda del
            // avance; con eso los contornos exteriores y los agujeros salen con
            // sentidos de giro opuestos y se distinguen por el area con signo
            match case {
                1 => push(left, top, &mut links),
                2 => push(top, right, &mut links),
                3 => push(left, right, &mut links),
                4 => push(right, bottom, &mut links),
                // Diagonal: se resuelve como tinta conectada (8-conectividad)
                5 => {
                    push(left, top, &mut links);
                    push(right, bottom, &mut links);
                }
                6 => push(top, bottom, &mut links),
                7 => push(left, bottom, &mut links),
                8 => push(bottom, left, &mut links),
                9 => push(bottom, top, &mut links),
                10 => {
                    push(top, right, &mut links);
                    push(bottom, left, &mut links);
                }
                11 => push(bottom, right, &mut links),
                12 => push(right, left, &mut links),
                13 => push(right, top, &mut links),
                14 => push(top, left, &mut links),
                _ => {}
            }
        }
    }

    let mut loops = Vec::new();
    let starts: Vec<PtKey> = links.keys().copied().collect();
    for start in starts {
        while links.get(&start).is_some_and(|v| !v.is_empty()) {
            let mut contour: Contour = Vec::new();
            let mut cursor = start;
            // Si la cadena se corta (no deberia, con el marco de fondo) el loop
            // parcial se abandona en vez de colgarse
            while let Some(next) = links.get_mut(&cursor).and_then(|v| v.pop()) {
                contour.push(key_to_px(cursor));
                cursor = next;
                if cursor == start {
                    break;
                }
            }
            if contour.len() >= 3 {
                loops.push(contour);
            }
        }
    }

    loops
}

/// De medios pixeles de la rejilla con marco a coordenadas de pixel de la
/// imagen original.
fn key_to_px(k: PtKey) -> [f64; 2] {
    [k.0 as f64 / 2.0 - 1.0, k.1 as f64 / 2.0 - 1.0]
}

/// Area con signo. Positiva y negativa separan contorno exterior de agujero;
/// cual es cual depende del sentido de la tabla de marching squares, asi que se
/// decide por mayoria: el contorno mas grande siempre es exterior.
fn signed_area(pts: &[[f64; 2]]) -> f64 {
    let n = pts.len();
    let mut acc = 0.0;
    for i in 0..n {
        let a = pts[i];
        let b = pts[(i + 1) % n];
        acc += a[0] * b[1] - b[0] * a[1];
    }
    acc / 2.0
}

/// Separa exteriores de agujeros y descarta lo que no llega al area minima.
fn classify_loops(loops: Vec<Contour>, min_area: f64) -> (Vec<Contour>, Vec<Contour>) {
    let mut with_area: Vec<(f64, Contour)> = loops
        .into_iter()
        .map(|c| (signed_area(&c), c))
        .filter(|(a, _)| a.abs() >= min_area.max(1.0))
        .collect();

    if with_area.is_empty() {
        return (Vec::new(), Vec::new());
    }

    // El de area absoluta mayor es, por fuerza, un contorno exterior: su signo
    // fija la convencion para todos los demas
    with_area.sort_by(|a, b| b.0.abs().partial_cmp(&a.0.abs()).unwrap());
    let outer_sign = with_area[0].0.signum();

    let mut outers = Vec::new();
    let mut holes = Vec::new();
    for (area, contour) in with_area {
        if area.signum() == outer_sign {
            outers.push(contour);
        } else {
            holes.push(contour);
        }
    }
    (outers, holes)
}

/// Indice del contorno exterior mas chico que contiene al agujero.
fn smallest_container(outers: &[Contour], hole: &[[f64; 2]]) -> Option<usize> {
    let probe = hole[0];
    let mut best: Option<(usize, f64)> = None;
    for (i, outer) in outers.iter().enumerate() {
        if !point_in_polygon(probe, outer) {
            continue;
        }
        let area = signed_area(outer).abs();
        if best.is_none_or(|(_, a)| area < a) {
            best = Some((i, area));
        }
    }
    best.map(|(i, _)| i)
}

fn point_in_polygon(p: [f64; 2], poly: &[[f64; 2]]) -> bool {
    let mut inside = false;
    let n = poly.len();
    let mut j = n - 1;
    for i in 0..n {
        let (xi, yi) = (poly[i][0], poly[i][1]);
        let (xj, yj) = (poly[j][0], poly[j][1]);
        if (yi > p[1]) != (yj > p[1]) {
            let x_cross = xi + (p[1] - yi) / (yj - yi) * (xj - xi);
            if p[0] < x_cross {
                inside = !inside;
            }
        }
        j = i;
    }
    inside
}

/// Douglas-Peucker sobre un contorno cerrado. Se ancla en el punto mas lejano
/// al primero para que el corte no dependa de donde arranco el trazado.
fn simplify_closed(contour: &[[f64; 2]], tolerance: f64) -> Contour {
    if tolerance <= 0.0 || contour.len() < 4 {
        return contour.to_vec();
    }

    let anchor = contour[0];
    let far = contour
        .iter()
        .enumerate()
        .max_by(|(_, a), (_, b)| dist2(anchor, **a).partial_cmp(&dist2(anchor, **b)).unwrap())
        .map(|(i, _)| i)
        .unwrap_or(0);

    if far == 0 {
        return douglas_peucker(contour, tolerance);
    }

    // Dos cadenas abiertas: [0..far] y [far..0]. Cada extremo es un punto fijo
    // del resultado, asi que la union no se puede saltar la curva del otro lado
    let mut back = contour[far..].to_vec();
    back.push(contour[0]);

    let mut out = douglas_peucker(&contour[..=far], tolerance);
    let tail = douglas_peucker(&back, tolerance);
    out.extend(tail.into_iter().skip(1));

    if out.len() > 1 && out[0] == out[out.len() - 1] {
        out.pop();
    }
    out
}

fn douglas_peucker(pts: &[[f64; 2]], tolerance: f64) -> Vec<[f64; 2]> {
    if pts.len() < 3 {
        return pts.to_vec();
    }

    let (first, last) = (pts[0], pts[pts.len() - 1]);
    let mut max_dist = 0.0;
    let mut idx = 0;
    for (i, p) in pts.iter().enumerate().take(pts.len() - 1).skip(1) {
        let d = perpendicular_distance(*p, first, last);
        if d > max_dist {
            max_dist = d;
            idx = i;
        }
    }

    if max_dist <= tolerance {
        return vec![first, last];
    }

    let mut left = douglas_peucker(&pts[..=idx], tolerance);
    let right = douglas_peucker(&pts[idx..], tolerance);
    left.pop();
    left.extend(right);
    left
}

fn perpendicular_distance(p: [f64; 2], a: [f64; 2], b: [f64; 2]) -> f64 {
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let len2 = dx * dx + dy * dy;
    if len2 == 0.0 {
        return dist2(p, a).sqrt();
    }
    ((p[0] - a[0]) * dy - (p[1] - a[1]) * dx).abs() / len2.sqrt()
}

fn dist2(a: [f64; 2], b: [f64; 2]) -> f64 {
    let (dx, dy) = (a[0] - b[0], a[1] - b[1]);
    dx * dx + dy * dy
}

/// Contorno cerrado a comando SVG. Con smooth = 0 sale como polilinea; con
/// smooth > 0, cada tramo pasa a cubica con tangentes tipo Catmull-Rom, salvo
/// en las esquinas duras, que se dejan en pico.
fn contour_to_d(pts: &[[f64; 2]], smooth: f64) -> String {
    let n = pts.len();
    let mut d = String::new();
    let _ = write!(d, "M {:.3} {:.3}", pts[0][0], pts[0][1]);

    if smooth <= 0.0 {
        for p in pts.iter().skip(1) {
            let _ = write!(d, " L {:.3} {:.3}", p[0], p[1]);
        }
        d.push_str(" Z");
        return d;
    }

    let amount = smooth.clamp(0.0, 1.0) / 3.0;
    // Angulo a partir del cual el vertice se trata como esquina y no se redondea
    const CORNER_COS: f64 = 0.2; // ~78 grados de giro

    // Direccion unitaria de la tangente en cada vertice. Va normalizada a
    // proposito: el largo del handle lo pone despues cada tramo. Escalar
    // directamente (next - prev), que es lo que sale de Catmull-Rom uniforme,
    // dispara la curva cuando los tramos tienen largos muy distintos — y
    // despues de simplificar siempre los tienen
    let dir = |i: usize| -> [f64; 2] {
        if is_corner(pts, i, n, CORNER_COS) {
            return [0.0, 0.0];
        }
        let prev = pts[(i + n - 1) % n];
        let next = pts[(i + 1) % n];
        let v = [next[0] - prev[0], next[1] - prev[1]];
        let len = (v[0] * v[0] + v[1] * v[1]).sqrt();
        if len == 0.0 {
            [0.0, 0.0]
        } else {
            [v[0] / len, v[1] / len]
        }
    };

    for i in 0..n {
        let p0 = pts[i];
        let p1 = pts[(i + 1) % n];
        let seg = ((p1[0] - p0[0]).powi(2) + (p1[1] - p0[1]).powi(2)).sqrt();
        let h = amount * seg;
        let d0 = dir(i);
        let d1 = dir((i + 1) % n);
        let c1 = [p0[0] + d0[0] * h, p0[1] + d0[1] * h];
        let c2 = [p1[0] - d1[0] * h, p1[1] - d1[1] * h];
        let _ = write!(
            d,
            " C {:.3} {:.3} {:.3} {:.3} {:.3} {:.3}",
            c1[0], c1[1], c2[0], c2[1], p1[0], p1[1]
        );
    }
    d.push_str(" Z");
    d
}

/// Un vertice es esquina cuando los dos tramos que lo tocan forman un angulo
/// marcado. Redondear ahi convierte un rectangulo en una papa.
fn is_corner(pts: &[[f64; 2]], i: usize, n: usize, corner_cos: f64) -> bool {
    let prev = pts[(i + n - 1) % n];
    let cur = pts[i];
    let next = pts[(i + 1) % n];
    let a = [cur[0] - prev[0], cur[1] - prev[1]];
    let b = [next[0] - cur[0], next[1] - cur[1]];
    let la = (a[0] * a[0] + a[1] * a[1]).sqrt();
    let lb = (b[0] * b[0] + b[1] * b[1]).sqrt();
    if la == 0.0 || lb == 0.0 {
        return true;
    }
    let cos = (a[0] * b[0] + a[1] * b[1]) / (la * lb);
    cos < corner_cos
}

fn build_svg(paths: &[String], w_mm: f64, h_mm: f64) -> String {
    let mut svg = String::new();
    let _ = write!(
        svg,
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="{:.3}mm" height="{:.3}mm" viewBox="0 0 {:.3} {:.3}">"#,
        w_mm, h_mm, w_mm, h_mm
    );
    for d in paths {
        let _ = write!(
            svg,
            r##"<path d="{}" fill="none" stroke="#000000" stroke-width="0.2" fill-rule="evenodd"/>"##,
            d
        );
    }
    svg.push_str("</svg>");
    svg
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Lienzo de w x h con un rectangulo de tinta [x0,x1) x [y0,y1)
    fn rect_mask(w: usize, h: usize, x0: usize, y0: usize, x1: usize, y1: usize) -> Vec<bool> {
        let mut m = vec![false; w * h];
        for y in y0..y1 {
            for x in x0..x1 {
                m[y * w + x] = true;
            }
        }
        m
    }

    #[test]
    fn cuadrado_solido_da_un_contorno_del_tamaño_correcto() {
        let (w, h) = (20, 20);
        let mask = rect_mask(w, h, 5, 5, 15, 15);
        let loops = march_squares(&mask, w, h);
        assert_eq!(loops.len(), 1, "un solo contorno");

        let (outers, holes) = classify_loops(loops, 1.0);
        assert_eq!(outers.len(), 1);
        assert!(holes.is_empty());
        // 10x10 pixeles de tinta: el contorno corre medio pixel afuera del
        // ultimo pixel encendido, con las cuatro esquinas cortadas en diagonal
        let area = signed_area(&outers[0]).abs();
        assert!((area - 99.5).abs() < 0.6, "area inesperada: {}", area);
    }

    #[test]
    fn agujero_sale_con_giro_contrario_y_se_clasifica_como_agujero() {
        let (w, h) = (30, 30);
        let mut mask = rect_mask(w, h, 5, 5, 25, 25);
        for y in 12..18 {
            for x in 12..18 {
                mask[y * w + x] = false;
            }
        }

        let loops = march_squares(&mask, w, h);
        assert_eq!(loops.len(), 2, "contorno exterior + agujero");

        let (outers, holes) = classify_loops(loops, 1.0);
        assert_eq!(outers.len(), 1, "un exterior");
        assert_eq!(holes.len(), 1, "un agujero");
        assert_eq!(smallest_container(&outers, &holes[0]), Some(0));
    }

    #[test]
    fn modo_silueta_descarta_los_agujeros() {
        let (w, h) = (30, 30);
        let mut mask = rect_mask(w, h, 5, 5, 25, 25);
        for y in 12..18 {
            for x in 12..18 {
                mask[y * w + x] = false;
            }
        }
        let img = mask_to_image(&mask, w, h);

        let silueta = trace_image(
            img.clone(),
            100.0,
            100.0,
            TraceOptions { mode: TraceMode::Silhouette, ..Default::default() },
            ImageFilters::default(),
        )
        .unwrap();
        assert_eq!(silueta.hole_count, 0);
        assert_eq!(silueta.path_count, 1);

        let completo = trace_image(
            img,
            100.0,
            100.0,
            TraceOptions { mode: TraceMode::Outline, ..Default::default() },
            ImageFilters::default(),
        )
        .unwrap();
        assert_eq!(completo.hole_count, 1);
        assert_eq!(completo.path_count, 1, "el agujero es subpath, no path aparte");
        assert_eq!(completo.svg.matches("<path").count(), 1);
    }

    #[test]
    fn dos_manchas_separadas_dan_dos_paths() {
        let (w, h) = (40, 20);
        let mut mask = rect_mask(w, h, 3, 5, 13, 15);
        for y in 5..15 {
            for x in 25..35 {
                mask[y * w + x] = true;
            }
        }
        let result = trace_image(
            mask_to_image(&mask, w, h),
            100.0,
            100.0,
            TraceOptions::default(),
            ImageFilters::default(),
        )
        .unwrap();
        assert_eq!(result.path_count, 2);
    }

    #[test]
    fn min_area_descarta_el_ruido() {
        let (w, h) = (40, 40);
        let mut mask = rect_mask(w, h, 5, 5, 25, 25);
        // Mancha de 2x2 lejos de la figura
        for y in 34..36 {
            for x in 34..36 {
                mask[y * w + x] = true;
            }
        }
        let img = mask_to_image(&mask, w, h);

        let sin_filtro = trace_image(
            img.clone(),
            100.0,
            100.0,
            TraceOptions { min_area: 1, ..Default::default() },
            ImageFilters::default(),
        )
        .unwrap();
        assert_eq!(sin_filtro.path_count, 2);

        let con_filtro = trace_image(
            img,
            100.0,
            100.0,
            TraceOptions { min_area: 20, ..Default::default() },
            ImageFilters::default(),
        )
        .unwrap();
        assert_eq!(con_filtro.path_count, 1, "la mancha chica se descarta");
    }

    #[test]
    fn simplificar_baja_los_nodos_sin_perder_la_figura() {
        let (w, h) = (60, 60);
        let mask = rect_mask(w, h, 10, 10, 50, 50);
        let img = mask_to_image(&mask, w, h);

        let crudo = trace_image(
            img.clone(),
            100.0,
            100.0,
            TraceOptions { simplify: 0.0, smooth: 0.0, ..Default::default() },
            ImageFilters::default(),
        )
        .unwrap();
        let simple = trace_image(
            img,
            100.0,
            100.0,
            TraceOptions { simplify: 1.0, smooth: 0.0, ..Default::default() },
            ImageFilters::default(),
        )
        .unwrap();

        assert!(crudo.point_count > 100, "sin simplificar hay un nodo por borde de pixel");
        assert!(
            simple.point_count <= 8,
            "un cuadrado simplificado son 4 esquinas, quedaron {}",
            simple.point_count
        );
    }

    #[test]
    fn invertir_cambia_que_es_tinta() {
        let (w, h) = (30, 30);
        let mask = rect_mask(w, h, 10, 10, 20, 20);
        let img = mask_to_image(&mask, w, h);

        let normal = trace_image(
            img.clone(),
            100.0,
            100.0,
            TraceOptions::default(),
            ImageFilters::default(),
        )
        .unwrap();
        assert_eq!(normal.path_count, 1);
        assert_eq!(normal.hole_count, 0);

        // Invertido, la tinta es el fondo: el cuadrado pasa a ser el agujero
        let invertido = trace_image(
            img,
            100.0,
            100.0,
            TraceOptions { invert: true, ..Default::default() },
            ImageFilters::default(),
        )
        .unwrap();
        assert_eq!(invertido.hole_count, 1);
    }

    #[test]
    fn la_salida_respeta_el_area_util_y_la_proporcion() {
        let (w, h) = (40, 20);
        let mask = rect_mask(w, h, 2, 2, 38, 18);
        let result = trace_image(
            mask_to_image(&mask, w, h),
            200.0,
            200.0,
            TraceOptions::default(),
            ImageFilters::default(),
        )
        .unwrap();

        assert!((result.width_mm - 200.0).abs() < 0.01);
        assert!((result.height_mm - 100.0).abs() < 0.01, "2:1 se mantiene");
        assert!(result.svg.contains(r#"viewBox="0 0 200.000 100.000""#));
    }

    #[test]
    fn imagen_en_blanco_da_error_util() {
        let (w, h) = (20, 20);
        let mask = vec![false; w * h];
        let err = trace_image(
            mask_to_image(&mask, w, h),
            100.0,
            100.0,
            TraceOptions::default(),
            ImageFilters::default(),
        )
        .unwrap_err();
        assert!(err.contains("contorno"), "mensaje inutil: {}", err);
    }

    #[test]
    fn suavizado_emite_cubicas_y_sin_suavizado_rectas() {
        let (w, h) = (30, 30);
        let mask = rect_mask(w, h, 5, 5, 25, 25);
        let img = mask_to_image(&mask, w, h);

        let recto = trace_image(
            img.clone(),
            100.0,
            100.0,
            TraceOptions { smooth: 0.0, ..Default::default() },
            ImageFilters::default(),
        )
        .unwrap();
        assert!(recto.svg.contains(" L "));
        assert!(!recto.svg.contains(" C "));

        let suave = trace_image(
            img,
            100.0,
            100.0,
            TraceOptions { smooth: 0.8, ..Default::default() },
            ImageFilters::default(),
        )
        .unwrap();
        assert!(suave.svg.contains(" C "));
    }

    /// Smoke manual sobre un archivo real: TRACE_IN=... TRACE_OUT=... [TRACE_MODE=silhouette]
    #[test]
    #[ignore]
    fn smoke_archivo() {
        let input = std::env::var("TRACE_IN").unwrap();
        let output = std::env::var("TRACE_OUT").unwrap();
        let silhouette = std::env::var("TRACE_MODE").map(|m| m == "silhouette").unwrap_or(false);
        let img = image::open(&input).unwrap();
        let num = |k: &str, d: f64| std::env::var(k).ok().and_then(|v| v.parse().ok()).unwrap_or(d);
        let opts = TraceOptions {
            mode: if silhouette { TraceMode::Silhouette } else { TraceMode::Outline },
            min_area: 20,
            simplify: num("TRACE_SIMPLIFY", 0.8),
            smooth: num("TRACE_SMOOTH", 0.6),
            ..Default::default()
        };
        let t0 = std::time::Instant::now();
        let res = trace_image(img, 200.0, 200.0, opts, ImageFilters::default()).unwrap();
        println!(
            "paths={} holes={} points={} {:.1}x{:.1}mm traced={}x{} en {:?}",
            res.path_count, res.hole_count, res.point_count, res.width_mm, res.height_mm,
            res.traced_width, res.traced_height, t0.elapsed()
        );
        std::fs::write(output, res.svg).unwrap();
    }

    fn mask_to_image(mask: &[bool], w: usize, h: usize) -> DynamicImage {
        let img = GrayImage::from_fn(w as u32, h as u32, |x, y| {
            image::Luma([if mask[y as usize * w + x as usize] { 0 } else { 255 }])
        });
        DynamicImage::ImageLuma8(img)
    }
}
