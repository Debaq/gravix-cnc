//! Import de vectores desde PDF, AI y EPS.
//!
//! Los tres formatos describen el dibujo con el mismo puñado de operadores de
//! trazado; lo que cambia es el envoltorio. PDF los guarda en streams
//! comprimidos dentro de una estructura de objetos, y EPS/PostScript los deja
//! en texto plano con una maquina de pila alrededor. Un `.ai` moderno es un
//! PDF con otro nombre, y uno viejo es PostScript, asi que el formato se
//! decide por el contenido y no por la extension.
//!
//! Lo que **no** hace, dicho de frente:
//!
//! - **Texto**: se ignora. Convertirlo a curvas pide leer las fuentes
//!   embebidas, que es otro modulo entero. El texto de un PDF no aparece.
//! - **DWG**: no entra. Es binario, propietario y sin una lectura razonable
//!   sin una libreria dedicada.
//! - **Relleno, color, grosor y clipping**: se descartan. Lo que importa aca
//!   es la geometria, que es lo que va a la maquina.
//! - **PDF de varias paginas**: entra solo la primera (y se avisa).
//! - **PDF cifrado**: no se descifra; los streams salen ilegibles y el import
//!   avisa en vez de devolver basura.

use flate2::read::ZlibDecoder;
use serde::{Deserialize, Serialize};
use std::fmt::Write as _;
use std::io::Read;
use std::path::Path;

/// Un punto por unidad: PDF y PostScript miden en puntos (1/72 pulgada).
const MM_PER_POINT: f64 = 25.4 / 72.0;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum VectorFormat {
    #[serde(rename = "pdf")]
    Pdf,
    #[serde(rename = "eps")]
    Eps,
}

#[derive(Debug, Serialize)]
pub struct VectorImportResult {
    /// SVG en mm, listo para el lienzo.
    pub svg: String,
    pub format: VectorFormat,
    pub path_count: usize,
    pub point_count: usize,
    pub width_mm: f64,
    pub height_mm: f64,
    /// true si el archivo tenia texto, que no se importa.
    pub had_text: bool,
    /// Paginas del archivo. Si hay mas de una, solo entro la primera.
    pub page_count: usize,
}

/// Comando de trazado ya en coordenadas del dispositivo (puntos, Y hacia
/// arriba como en PDF/PostScript).
#[derive(Debug, Clone, PartialEq)]
enum PathCmd {
    Move(f64, f64),
    Line(f64, f64),
    Cubic(f64, f64, f64, f64, f64, f64),
    Close,
}

/// Matriz af铆n [a b c d e f] al estilo PDF.
#[derive(Debug, Clone, Copy)]
struct Matrix([f64; 6]);

impl Matrix {
    fn identity() -> Self {
        Matrix([1.0, 0.0, 0.0, 1.0, 0.0, 0.0])
    }

    fn apply(&self, x: f64, y: f64) -> (f64, f64) {
        let m = self.0;
        (m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5])
    }

    /// self aplicada primero, luego `outer` — el orden de `cm`/`concat`.
    fn then(&self, outer: &Matrix) -> Matrix {
        let a = self.0;
        let b = outer.0;
        Matrix([
            a[0] * b[0] + a[1] * b[2],
            a[0] * b[1] + a[1] * b[3],
            a[2] * b[0] + a[3] * b[2],
            a[2] * b[1] + a[3] * b[3],
            a[4] * b[0] + a[5] * b[2] + b[4],
            a[4] * b[1] + a[5] * b[3] + b[5],
        ])
    }
}

#[tauri::command]
pub async fn import_vector_file(path: String) -> Result<VectorImportResult, String> {
    tokio::task::spawn_blocking(move || {
        let bytes = std::fs::read(Path::new(&path))
            .map_err(|e| format!("Error al leer el archivo: {}", e))?;
        import_vector_bytes(&bytes)
    })
    .await
    .map_err(|e| format!("Error en thread: {}", e))?
}

pub fn import_vector_bytes(bytes: &[u8]) -> Result<VectorImportResult, String> {
    let format = detect_format(bytes)?;
    let (subpaths, page, had_text) = match format {
        VectorFormat::Pdf => parse_pdf(bytes)?,
        VectorFormat::Eps => parse_eps(bytes)?,
    };

    // Un `moveto` suelto antes de pintar no dibuja nada; como path queda un
    // punto sin geometria que solo ensucia la lista de elementos
    let subpaths: Vec<Vec<PathCmd>> = subpaths
        .into_iter()
        .map(|mut p| {
            // Un `moveto` al final tampoco dibuja: se va, junto con el nodo
            // suelto que dejaria en el lienzo
            while matches!(p.last(), Some(PathCmd::Move(..))) {
                p.pop();
            }
            p
        })
        .filter(|p| p.iter().any(|c| matches!(c, PathCmd::Line(..) | PathCmd::Cubic(..))))
        .collect();

    if subpaths.is_empty() {
        return Err(
            "No se encontro geometria vectorial. Si el archivo es solo texto o imagen, no hay contornos que importar"
                .into(),
        );
    }

    Ok(build_result(subpaths, page, format, had_text))
}

/// El formato sale del contenido: un `.ai` moderno es PDF y uno viejo es
/// PostScript, asi que mirar la extension no alcanza.
fn detect_format(bytes: &[u8]) -> Result<VectorFormat, String> {
    let head = &bytes[..bytes.len().min(1024)];
    if find(head, b"%PDF").is_some() {
        return Ok(VectorFormat::Pdf);
    }
    if find(head, b"%!PS").is_some() || find(head, b"%%BoundingBox").is_some() {
        return Ok(VectorFormat::Eps);
    }
    // EPS con preview binario: cabecera DOS de 30 bytes con los offsets
    if bytes.len() > 30 && bytes[0..4] == [0xC5, 0xD0, 0xD3, 0xC6] {
        return Ok(VectorFormat::Eps);
    }
    Err("Formato no reconocido: se esperaba PDF, AI o EPS".into())
}

/// Caja de la pagina en puntos (x0, y0, x1, y1).
#[derive(Debug, Clone, Copy)]
struct PageBox {
    y_top: f64,
    /// Paginas del documento (1 en EPS). Solo se importa la primera.
    pages: usize,
}

// ============================================
// PDF
// ============================================

fn parse_pdf(bytes: &[u8]) -> Result<(Vec<Vec<PathCmd>>, PageBox, bool), String> {
    if find(&bytes[..bytes.len().min(4096)], b"/Encrypt").is_some() {
        return Err("El PDF esta cifrado y no se puede leer".into());
    }

    // Camino normal: se resuelve la estructura de objetos y se dibuja SOLO la
    // primera pagina, con sus Form XObjects y su rotacion.
    let doc = PdfDoc::parse(bytes);
    if let Some(page) = doc.first_page() {
        if let Some(result) = doc.render_page(page) {
            if !result.0.is_empty() {
                return Ok(result);
            }
        }
    }

    // Respaldo para archivos con la estructura rota: se barren todos los
    // streams con trazado. Junta todas las paginas, pero rescata geometria de
    // PDF que de otro modo no abririan.
    let y_top = pdf_media_box_top(bytes).unwrap_or(842.0); // A4 por defecto
    let mut subpaths = Vec::new();
    let mut had_text = false;

    for content in pdf_content_streams(bytes) {
        let (paths, text) = parse_content_stream(&content);
        had_text |= text;
        subpaths.extend(paths);
    }

    Ok((subpaths, PageBox { y_top, pages: 1 }, had_text))
}

// --- Estructura de objetos del PDF ---

struct PdfObj {
    /// Todo el cuerpo del objeto antes del stream, como texto.
    dict: String,
    /// Stream ya descomprimido (None si no tiene o no se pudo leer).
    stream: Option<Vec<u8>>,
}

struct PdfDoc {
    objs: std::collections::HashMap<u32, PdfObj>,
}

impl PdfDoc {
    fn parse(bytes: &[u8]) -> PdfDoc {
        let mut objs = std::collections::HashMap::new();
        let mut cursor = 0usize;

        while let Some(rel) = find(&bytes[cursor..], b" obj") {
            let kw = cursor + rel;
            cursor = kw + 4;
            // Hacia atras: "<num> <gen>" justo antes de " obj"
            let Some(id) = obj_number_before(bytes, kw) else { continue };
            let body_start = kw + 4;
            let Some(end_rel) = find(&bytes[body_start..], b"endobj") else { break };
            let body = &bytes[body_start..body_start + end_rel];
            cursor = body_start + end_rel + 6;

            let (dict, stream) = match find(body, b"stream") {
                Some(sp) => {
                    let dict = String::from_utf8_lossy(&body[..sp]).to_string();
                    let mut ds = sp + 6;
                    while ds < body.len() && (body[ds] == b'\r' || body[ds] == b'\n') {
                        ds += 1;
                    }
                    let de = find(&body[ds..], b"endstream").map(|e| ds + e).unwrap_or(body.len());
                    let raw = &body[ds..de];
                    let data = if dict.contains("/FlateDecode") {
                        inflate(raw)
                    } else if dict.contains("/Filter") {
                        None
                    } else {
                        Some(raw.to_vec())
                    };
                    (dict, data)
                }
                None => (String::from_utf8_lossy(body).to_string(), None),
            };
            objs.insert(id, PdfObj { dict, stream });
        }

        // Los PDF modernos guardan los diccionarios (paginas incluidas) dentro
        // de object streams comprimidos.
        let mut packed: Vec<(u32, PdfObj)> = Vec::new();
        for obj in objs.values() {
            if !obj.dict.contains("/ObjStm") {
                continue;
            }
            let Some(data) = obj.stream.as_ref() else { continue };
            let n = dict_number(&obj.dict, "/N").unwrap_or(0.0) as usize;
            let first = dict_number(&obj.dict, "/First").unwrap_or(0.0) as usize;
            if first > data.len() {
                continue;
            }
            let header = String::from_utf8_lossy(&data[..first]);
            let nums: Vec<usize> = header.split_whitespace().filter_map(|t| t.parse().ok()).collect();
            for i in 0..n.min(nums.len() / 2) {
                let id = nums[i * 2] as u32;
                let start = first + nums[i * 2 + 1];
                let end = if i + 1 < n && (i + 1) * 2 + 1 < nums.len() {
                    first + nums[(i + 1) * 2 + 1]
                } else {
                    data.len()
                };
                if start <= end && end <= data.len() {
                    packed.push((
                        id,
                        PdfObj {
                            dict: String::from_utf8_lossy(&data[start..end]).to_string(),
                            stream: None,
                        },
                    ));
                }
            }
        }
        for (id, obj) in packed {
            objs.entry(id).or_insert(obj);
        }

        PdfDoc { objs }
    }

    fn get(&self, id: u32) -> Option<&PdfObj> {
        self.objs.get(&id)
    }

    /// Primera pagina segun el arbol /Pages; si no se puede seguir, la de
    /// menor numero de objeto.
    fn first_page(&self) -> Option<u32> {
        let catalog = self.objs.values().find(|o| dict_has_type(&o.dict, "Catalog"));
        if let Some(root) = catalog.and_then(|c| dict_refs(&c.dict, "/Pages").first().copied()) {
            let mut node = root;
            for _ in 0..32 {
                let obj = self.get(node)?;
                if dict_has_type(&obj.dict, "Page") {
                    return Some(node);
                }
                match dict_refs(&obj.dict, "/Kids").first() {
                    Some(k) => node = *k,
                    None => break,
                }
            }
        }
        self.objs
            .iter()
            .filter(|(_, o)| dict_has_type(&o.dict, "Page"))
            .map(|(id, _)| *id)
            .min()
    }

    /// Valor de una clave heredable (MediaBox, Rotate, Resources): se busca
    /// en la pagina y, si falta, subiendo por /Parent.
    fn inherited(&self, page: u32, key: &str) -> Option<String> {
        let mut node = page;
        for _ in 0..16 {
            let obj = self.get(node)?;
            if let Some(v) = dict_value(&obj.dict, key) {
                return Some(self.resolve(v));
            }
            node = *dict_refs(&obj.dict, "/Parent").first()?;
        }
        None
    }

    /// Si el valor es una referencia `N G R`, devuelve el cuerpo del objeto.
    fn resolve(&self, value: String) -> String {
        match single_ref(&value).and_then(|id| self.get(id)) {
            Some(obj) => obj.dict.clone(),
            None => value,
        }
    }

    /// Contenido de la pagina: /Contents puede ser un stream, un arreglo de
    /// streams o una referencia a un arreglo.
    fn page_content(&self, page: u32) -> Vec<u8> {
        let mut out = Vec::new();
        let Some(obj) = self.get(page) else { return out };
        let Some(value) = dict_value(&obj.dict, "/Contents") else { return out };
        let mut ids = all_refs(&value);
        if ids.len() == 1 {
            if let Some(target) = self.get(ids[0]) {
                if target.stream.is_none() {
                    ids = all_refs(&target.dict);
                }
            }
        }
        for id in ids {
            if let Some(data) = self.get(id).and_then(|o| o.stream.as_ref()) {
                out.extend_from_slice(data);
                out.push(b'\n');
            }
        }
        out
    }

    fn render_page(&self, page: u32) -> Option<(Vec<Vec<PathCmd>>, PageBox, bool)> {
        let content = self.page_content(page);
        if content.is_empty() {
            return None;
        }
        let resources = self.inherited(page, "/Resources").unwrap_or_default();
        let mut out = Vec::new();
        let mut had_text = false;
        interpret_content(&content, Matrix::identity(), Some((self, &resources)), 0, &mut out, &mut had_text);

        let media: Vec<f64> = self
            .inherited(page, "/MediaBox")
            .map(|v| numbers_in(&v))
            .filter(|n| n.len() >= 4)
            .unwrap_or_else(|| vec![0.0, 0.0, 595.0, 842.0]);
        let (x0, y0) = (media[0].min(media[2]), media[1].min(media[3]));
        let (w, h) = ((media[2] - media[0]).abs(), (media[3] - media[1]).abs());
        let rotate = self
            .inherited(page, "/Rotate")
            .and_then(|v| numbers_in(&v).first().copied())
            .unwrap_or(0.0);
        let rotate = (((rotate as i64) % 360) + 360) % 360;
        let unit = dict_number(&self.get(page)?.dict, "/UserUnit").filter(|u| *u > 0.0).unwrap_or(1.0);

        // /Rotate gira la pagina en sentido horario al mostrarla: se aplica a
        // la geometria para que entre como se ve en cualquier visor.
        let (map, y_top): (Box<dyn Fn(f64, f64) -> (f64, f64)>, f64) = match rotate {
            90 => (Box::new(move |x, y| ((y - y0) * unit, (w - (x - x0)) * unit)), w * unit),
            180 => (Box::new(move |x, y| ((w - (x - x0)) * unit, (h - (y - y0)) * unit)), h * unit),
            270 => (Box::new(move |x, y| ((h - (y - y0)) * unit, (x - x0) * unit)), w * unit),
            _ => (Box::new(move |x, y| (x * unit, y * unit)), (y0 + h) * unit),
        };
        for path in out.iter_mut() {
            for cmd in path.iter_mut() {
                *cmd = match *cmd {
                    PathCmd::Move(x, y) => { let p = map(x, y); PathCmd::Move(p.0, p.1) }
                    PathCmd::Line(x, y) => { let p = map(x, y); PathCmd::Line(p.0, p.1) }
                    PathCmd::Cubic(a, b, c, d, e, f) => {
                        let (p1, p2, p3) = (map(a, b), map(c, d), map(e, f));
                        PathCmd::Cubic(p1.0, p1.1, p2.0, p2.1, p3.0, p3.1)
                    }
                    PathCmd::Close => PathCmd::Close,
                };
            }
        }
        let pages = self.objs.values().filter(|o| dict_has_type(&o.dict, "Page")).count().max(1);
        Some((out, PageBox { y_top, pages }, had_text))
    }

    /// Form XObject por nombre: contenido, matriz y recursos propios.
    fn form_xobject(&self, resources: &str, name: &str) -> Option<(Vec<u8>, Matrix, Option<String>)> {
        let xobjects = self.resolve(dict_value(resources, "/XObject")?);
        let id = *dict_refs(&xobjects, &format!("/{}", name)).first()?;
        let obj = self.get(id)?;
        // Las imagenes tambien son XObjects, pero no traen trazado
        if !dict_value(&obj.dict, "/Subtype").map(|v| v.contains("Form")).unwrap_or(false) {
            return None;
        }
        let m = dict_value(&obj.dict, "/Matrix").map(|v| numbers_in(&v)).filter(|n| n.len() >= 6);
        let matrix = m
            .map(|n| Matrix([n[0], n[1], n[2], n[3], n[4], n[5]]))
            .unwrap_or_else(Matrix::identity);
        let res = dict_value(&obj.dict, "/Resources").map(|v| self.resolve(v));
        Some((obj.stream.clone()?, matrix, res))
    }
}

/// Numero de objeto en "`N G obj`", leyendo hacia atras desde la palabra clave.
fn obj_number_before(bytes: &[u8], kw: usize) -> Option<u32> {
    let mut i = kw;
    let digits_back = |i: &mut usize| -> Option<u32> {
        let end = *i;
        while *i > 0 && bytes[*i - 1].is_ascii_digit() {
            *i -= 1;
        }
        if *i == end {
            return None;
        }
        std::str::from_utf8(&bytes[*i..end]).ok()?.parse().ok()
    };
    digits_back(&mut i)?; // generacion
    if i == 0 || bytes[i - 1] != b' ' {
        return None;
    }
    i -= 1;
    let id = digits_back(&mut i)?;
    // Antes del numero tiene que haber un separador ("endobj\n12 0 obj")
    if i > 0 && !bytes[i - 1].is_ascii_whitespace() {
        return None;
    }
    Some(id)
}

/// Posicion de una clave `/Nombre` exacta (no `/NombreLargo`).
fn dict_key_pos(dict: &str, key: &str) -> Option<usize> {
    let bytes = dict.as_bytes();
    let mut from = 0;
    while let Some(rel) = dict[from..].find(key) {
        let end = from + rel + key.len();
        let next = bytes.get(end).copied().unwrap_or(b' ');
        if !(next.is_ascii_alphanumeric() || next == b'_' || next == b'.') {
            return Some(end);
        }
        from = end;
    }
    None
}

/// Valor crudo de una clave: un diccionario `<<..>>`, un arreglo `[..]` o
/// el texto hasta la proxima clave.
fn dict_value(dict: &str, key: &str) -> Option<String> {
    let start = dict_key_pos(dict, key)?;
    let rest = dict[start..].trim_start();
    let bytes = rest.as_bytes();
    if rest.starts_with("<<") {
        let mut depth = 0i32;
        let mut i = 0;
        while i + 1 < bytes.len() {
            if &bytes[i..i + 2] == b"<<" {
                depth += 1;
                i += 2;
            } else if &bytes[i..i + 2] == b">>" {
                depth -= 1;
                i += 2;
                if depth == 0 {
                    return Some(rest[..i].to_string());
                }
            } else {
                i += 1;
            }
        }
        return Some(rest.to_string());
    }
    if rest.starts_with('[') {
        let end = rest.find(']').map(|e| e + 1).unwrap_or(rest.len());
        return Some(rest[..end].to_string());
    }
    // Escalar o referencia: hasta la proxima clave o cierre
    let mut end = rest.len();
    for (i, c) in rest.char_indices().skip(1) {
        if c == '/' || c == '>' {
            end = i;
            break;
        }
    }
    Some(rest[..end].trim().to_string())
}

fn dict_number(dict: &str, key: &str) -> Option<f64> {
    numbers_in(&dict_value(dict, key)?).first().copied()
}

fn dict_refs(dict: &str, key: &str) -> Vec<u32> {
    dict_value(dict, key).map(|v| all_refs(&v)).unwrap_or_default()
}

/// true si el diccionario declara `/Type /<name>`. Se miran todas las
/// apariciones: un subdiccionario (`/Group << /Type /Group >>`) puede venir
/// antes que el tipo del propio objeto.
fn dict_has_type(dict: &str, name: &str) -> bool {
    let mut from = 0;
    while let Some(rel) = dict[from..].find("/Type") {
        let end = from + rel + 5;
        from = end;
        let rest = dict[end..].trim_start();
        if let Some(r) = rest.strip_prefix('/') {
            let exact = r.starts_with(name)
                && !r[name.len()..]
                    .chars()
                    .next()
                    .map(|c| c.is_ascii_alphanumeric())
                    .unwrap_or(false);
            if exact {
                return true;
            }
        }
    }
    false
}

fn numbers_in(text: &str) -> Vec<f64> {
    text.split(|c: char| !(c.is_ascii_digit() || c == '.' || c == '-' || c == '+'))
        .filter(|t| !t.is_empty())
        .filter_map(|t| t.parse().ok())
        .collect()
}

/// Todas las referencias `N G R` de un texto, en orden.
fn all_refs(text: &str) -> Vec<u32> {
    let tokens: Vec<&str> = text
        .split(|c: char| c.is_whitespace() || c == '[' || c == ']' || c == '<' || c == '>')
        .filter(|t| !t.is_empty())
        .collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i + 2 < tokens.len() {
        if tokens[i + 2] == "R" {
            if let (Ok(id), Ok(_gen)) = (tokens[i].parse::<u32>(), tokens[i + 1].parse::<u32>()) {
                out.push(id);
                i += 3;
                continue;
            }
        }
        i += 1;
    }
    out
}

fn single_ref(text: &str) -> Option<u32> {
    let t: Vec<&str> = text.split_whitespace().collect();
    if t.len() == 3 && t[2] == "R" {
        t[0].parse().ok()
    } else {
        None
    }
}

/// Alto de la pagina, para dar vuelta el eje Y al pasar a SVG.
fn pdf_media_box_top(bytes: &[u8]) -> Option<f64> {
    let pos = find(bytes, b"/MediaBox")?;
    let tail = &bytes[pos + 9..bytes.len().min(pos + 128)];
    let text = String::from_utf8_lossy(tail);
    let nums: Vec<f64> = text
        .trim_start()
        .trim_start_matches('[')
        .split(|c: char| !(c.is_ascii_digit() || c == '.' || c == '-'))
        .filter(|s| !s.is_empty())
        .filter_map(|s| s.parse().ok())
        .take(4)
        .collect();
    if nums.len() == 4 {
        Some(nums[3].max(nums[1]))
    } else {
        None
    }
}

/// Devuelve el contenido de cada stream que pueda tener trazado.
///
/// Se recorre el archivo buscando `stream`/`endstream` en vez de resolver la
/// tabla xref: para sacar geometria alcanza, y ademas sobrevive a los PDF con
/// xref rota, que son mas comunes de lo que uno quisiera.
fn pdf_content_streams(bytes: &[u8]) -> Vec<Vec<u8>> {
    let mut out = Vec::new();
    let mut cursor = 0usize;

    while let Some(rel) = find(&bytes[cursor..], b"stream") {
        let kw = cursor + rel;
        // "endstream" tambien contiene "stream": hay que saltearlo
        if kw >= 3 && &bytes[kw - 3..kw] == b"end" {
            cursor = kw + 6;
            continue;
        }

        // El diccionario del objeto esta justo antes
        let dict_start = bytes[..kw].rfind_seq(b"obj").map(|p| p + 3).unwrap_or(0);
        let dict = String::from_utf8_lossy(&bytes[dict_start..kw]).to_string();

        let mut data_start = kw + 6;
        while data_start < bytes.len() && (bytes[data_start] == b'\r' || bytes[data_start] == b'\n') {
            data_start += 1;
        }
        let end = match find(&bytes[data_start..], b"endstream") {
            Some(e) => data_start + e,
            None => break,
        };
        cursor = end + 9;

        // Imagenes, fuentes y metadatos no traen trazado
        let skip = dict.contains("/Image")
            || dict.contains("/Font")
            || dict.contains("/FontFile")
            || dict.contains("/Metadata")
            || dict.contains("/XML")
            || dict.contains("/ObjStm");
        if skip {
            continue;
        }

        let raw = &bytes[data_start..end];
        let decoded = if dict.contains("/FlateDecode") {
            match inflate(raw) {
                Some(d) => d,
                None => continue,
            }
        } else if dict.contains("/Filter") {
            // DCT, CCITT, JBIG2 y compañia son imagenes
            continue;
        } else {
            raw.to_vec()
        };

        // Un content stream es texto; lo que salga binario es una imagen o un
        // recurso que el diccionario no declaro. Buscar operadores sueltos no
        // sirve como filtro: `10 10 144 72 re S` no tiene ni m, ni l, ni c
        if mostly_ascii(&decoded) {
            out.push(decoded);
        }
    }

    out
}

/// Proporcion de bytes imprimibles en el arranque del stream.
fn mostly_ascii(data: &[u8]) -> bool {
    let sample = &data[..data.len().min(512)];
    if sample.is_empty() {
        return false;
    }
    let printable = sample
        .iter()
        .filter(|b| matches!(b, 0x09 | 0x0a | 0x0d | 0x20..=0x7e))
        .count();
    printable * 10 >= sample.len() * 9
}

fn inflate(data: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    let mut dec = ZlibDecoder::new(data);
    match dec.read_to_end(&mut out) {
        // Un stream truncado igual sirve si alcanzo a salir algo
        Ok(_) => Some(out),
        Err(_) if !out.is_empty() => Some(out),
        Err(_) => None,
    }
}

/// Interpreta los operadores de trazado de un content stream de PDF.
fn parse_content_stream(data: &[u8]) -> (Vec<Vec<PathCmd>>, bool) {
    let mut out = Vec::new();
    let mut had_text = false;
    interpret_content(data, Matrix::identity(), None, 0, &mut out, &mut had_text);
    (out, had_text)
}

/// Igual, pero con matriz inicial y, si se pasa el documento, resolviendo los
/// Form XObjects (`/Nombre Do`): Illustrator e Inkscape guardan ahi buena
/// parte del dibujo, con su propia matriz.
fn interpret_content(
    data: &[u8],
    base: Matrix,
    doc: Option<(&PdfDoc, &str)>,
    depth: usize,
    out: &mut Vec<Vec<PathCmd>>,
    had_text_out: &mut bool,
) {
    let text = String::from_utf8_lossy(data);
    let mut ctm = base;
    let mut stack: Vec<Matrix> = Vec::new();
    let mut operands: Vec<f64> = Vec::new();
    let mut last_name: Option<String> = None;

    let mut current: Vec<PathCmd> = Vec::new();
    let mut cursor = (0.0, 0.0);
    let mut start = (0.0, 0.0);
    let mut in_text = false;
    let mut had_text = false;
    let mut pending_clip = false;

    for token in tokenize_postscript(&text) {
        match token {
            PsToken::Number(n) => operands.push(n),
            PsToken::Other => operands.clear(),
            PsToken::Operator(op) => {
                // Un nombre (`/Fm0`) es operando del operador que sigue
                if let Some(name) = op.strip_prefix('/') {
                    last_name = Some(name.to_string());
                    continue;
                }
                match op.as_str() {
                    "Do" => {
                        if let (Some((pdf, resources)), Some(name)) = (doc, last_name.as_deref()) {
                            if depth < 8 {
                                if let Some((content, matrix, res)) = pdf.form_xobject(resources, name) {
                                    let child_res = res.unwrap_or_else(|| resources.to_string());
                                    interpret_content(
                                        &content,
                                        matrix.then(&ctm),
                                        Some((pdf, &child_res)),
                                        depth + 1,
                                        out,
                                        &mut had_text,
                                    );
                                }
                            }
                        }
                    }
                    "BT" => {
                        in_text = true;
                        had_text = true;
                    }
                    "ET" => in_text = false,
                    _ if in_text => {}

                    "q" => stack.push(ctm),
                    "Q" => {
                        if let Some(m) = stack.pop() {
                            ctm = m;
                        }
                    }
                    "cm" => {
                        if operands.len() >= 6 {
                            let a = &operands[operands.len() - 6..];
                            ctm = Matrix([a[0], a[1], a[2], a[3], a[4], a[5]]).then(&ctm);
                        }
                    }
                    "m" => {
                        if operands.len() >= 2 {
                            let (x, y) = last2(&operands);
                            let p = ctm.apply(x, y);
                            current.push(PathCmd::Move(p.0, p.1));
                            cursor = p;
                            start = p;
                        }
                    }
                    "l" => {
                        if operands.len() >= 2 {
                            let (x, y) = last2(&operands);
                            let p = ctm.apply(x, y);
                            current.push(PathCmd::Line(p.0, p.1));
                            cursor = p;
                        }
                    }
                    "c" => {
                        if operands.len() >= 6 {
                            let a = &operands[operands.len() - 6..];
                            let c1 = ctm.apply(a[0], a[1]);
                            let c2 = ctm.apply(a[2], a[3]);
                            let to = ctm.apply(a[4], a[5]);
                            current.push(PathCmd::Cubic(c1.0, c1.1, c2.0, c2.1, to.0, to.1));
                            cursor = to;
                        }
                    }
                    // v: el primer control es el punto actual
                    "v" => {
                        if operands.len() >= 4 {
                            let a = &operands[operands.len() - 4..];
                            let c2 = ctm.apply(a[0], a[1]);
                            let to = ctm.apply(a[2], a[3]);
                            current.push(PathCmd::Cubic(cursor.0, cursor.1, c2.0, c2.1, to.0, to.1));
                            cursor = to;
                        }
                    }
                    // y: el segundo control es el punto final
                    "y" => {
                        if operands.len() >= 4 {
                            let a = &operands[operands.len() - 4..];
                            let c1 = ctm.apply(a[0], a[1]);
                            let to = ctm.apply(a[2], a[3]);
                            current.push(PathCmd::Cubic(c1.0, c1.1, to.0, to.1, to.0, to.1));
                            cursor = to;
                        }
                    }
                    "h" => {
                        if !current.is_empty() {
                            current.push(PathCmd::Close);
                            cursor = start;
                        }
                    }
                    "re" => {
                        if operands.len() >= 4 {
                            let a = &operands[operands.len() - 4..];
                            let (x, y, w, h) = (a[0], a[1], a[2], a[3]);
                            let p0 = ctm.apply(x, y);
                            let p1 = ctm.apply(x + w, y);
                            let p2 = ctm.apply(x + w, y + h);
                            let p3 = ctm.apply(x, y + h);
                            current.push(PathCmd::Move(p0.0, p0.1));
                            current.push(PathCmd::Line(p1.0, p1.1));
                            current.push(PathCmd::Line(p2.0, p2.1));
                            current.push(PathCmd::Line(p3.0, p3.1));
                            current.push(PathCmd::Close);
                            cursor = p0;
                            start = p0;
                        }
                    }
                    "W" | "W*" => pending_clip = true,
                    "S" | "s" | "f" | "F" | "f*" | "B" | "B*" | "b" | "b*" | "n" => {
                        // `n` sin pintar suele ser el rectangulo de recorte de
                        // la pagina: entra como geometria fantasma
                        let is_clip_only = op == "n" && pending_clip;
                        if !current.is_empty() && !is_clip_only && op != "n" {
                            if matches!(op.as_str(), "s" | "b" | "b*") {
                                current.push(PathCmd::Close);
                            }
                            // Rellenar cierra cada subtrazado aunque no traiga
                            // `h`: sin esto un logo relleno llegaba abierto al
                            // CAM y no se podia compensar ni cajear.
                            if matches!(op.as_str(), "f" | "F" | "f*" | "B" | "B*" | "b" | "b*") {
                                close_subpaths(&mut current);
                            }
                            out.push(std::mem::take(&mut current));
                        } else {
                            current.clear();
                        }
                        pending_clip = false;
                    }
                    _ => {}
                }
                operands.clear();
                last_name = None;
            }
        }
    }

    *had_text_out |= had_text;
}

/// Cierra todo subtrazado que no termine en `Close` (semantica de relleno).
fn close_subpaths(cmds: &mut Vec<PathCmd>) {
    let mut out: Vec<PathCmd> = Vec::with_capacity(cmds.len() + 4);
    // Cantidad de comandos del subtrazado en curso (un Move solo no encierra nada)
    let mut len = 0usize;
    for cmd in cmds.drain(..) {
        if matches!(cmd, PathCmd::Move(..)) {
            if len > 1 && !matches!(out.last(), Some(PathCmd::Close)) {
                out.push(PathCmd::Close);
            }
            len = 0;
        }
        len += 1;
        out.push(cmd);
    }
    if len > 1 && !matches!(out.last(), Some(PathCmd::Close)) {
        out.push(PathCmd::Close);
    }
    *cmds = out;
}

fn last2(operands: &[f64]) -> (f64, f64) {
    (operands[operands.len() - 2], operands[operands.len() - 1])
}

// ============================================
// EPS / POSTSCRIPT
// ============================================

fn parse_eps(bytes: &[u8]) -> Result<(Vec<Vec<PathCmd>>, PageBox, bool), String> {
    let body = strip_dos_eps_header(bytes);
    let text = String::from_utf8_lossy(body);

    let y_top = eps_bounding_box(&text).map(|bb| bb.3).unwrap_or(842.0);
    let (paths, had_text) = run_postscript(&text);
    Ok((paths, PageBox { y_top, pages: 1 }, had_text))
}

/// Un EPS "de Windows" viene envuelto en una cabecera binaria con offsets: el
/// PostScript real arranca donde diga esa cabecera.
fn strip_dos_eps_header(bytes: &[u8]) -> &[u8] {
    if bytes.len() > 30 && bytes[0..4] == [0xC5, 0xD0, 0xD3, 0xC6] {
        let start = u32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]) as usize;
        let len = u32::from_le_bytes([bytes[8], bytes[9], bytes[10], bytes[11]]) as usize;
        if start < bytes.len() {
            let end = (start + len).min(bytes.len());
            return &bytes[start..end];
        }
    }
    bytes
}

fn eps_bounding_box(text: &str) -> Option<(f64, f64, f64, f64)> {
    for line in text.lines().take(200) {
        let key = "%%BoundingBox:";
        if let Some(rest) = line.strip_prefix(key) {
            let nums: Vec<f64> = rest
                .split_whitespace()
                .filter_map(|s| s.parse().ok())
                .collect();
            if nums.len() >= 4 {
                return Some((nums[0], nums[1], nums[2], nums[3]));
            }
        }
    }
    None
}

#[derive(Debug, Clone)]
enum PsToken {
    Number(f64),
    Operator(String),
    Other,
}

/// Tokeniza PostScript/PDF quedandose con lo unico que importa: numeros y
/// operadores. Comentarios, nombres y cadenas se descartan.
fn tokenize_postscript(text: &str) -> Vec<PsToken> {
    let mut out = Vec::new();
    let bytes = text.as_bytes();
    let mut i = 0;

    while i < bytes.len() {
        let c = bytes[i] as char;
        match c {
            ' ' | '\t' | '\r' | '\n' | '\x0c' | '\0' => i += 1,
            '%' => {
                while i < bytes.len() && bytes[i] != b'\n' {
                    i += 1;
                }
            }
            '(' => {
                // Cadena literal: hay que contar parentesis anidados
                let mut depth = 1;
                i += 1;
                while i < bytes.len() && depth > 0 {
                    match bytes[i] {
                        b'\\' => i += 1,
                        b'(' => depth += 1,
                        b')' => depth -= 1,
                        _ => {}
                    }
                    i += 1;
                }
                out.push(PsToken::Other);
            }
            '<' | '>' | '[' | ']' | '{' | '}' => {
                out.push(PsToken::Operator(c.to_string()));
                i += 1;
            }
            '/' => {
                i += 1;
                let start = i;
                while i < bytes.len() && !is_ps_delim(bytes[i]) {
                    i += 1;
                }
                out.push(PsToken::Operator(format!("/{}", &text[start..i])));
            }
            _ => {
                let start = i;
                while i < bytes.len() && !is_ps_delim(bytes[i]) {
                    i += 1;
                }
                let word = &text[start..i];
                if word.is_empty() {
                    i += 1;
                    continue;
                }
                match word.parse::<f64>() {
                    Ok(n) => out.push(PsToken::Number(n)),
                    Err(_) => out.push(PsToken::Operator(word.to_string())),
                }
            }
        }
    }

    out
}

fn is_ps_delim(b: u8) -> bool {
    matches!(
        b,
        b' ' | b'\t' | b'\r' | b'\n' | b'\x0c' | b'\0' | b'/' | b'(' | b')' | b'<' | b'>' | b'[' | b']' | b'{' | b'}' | b'%'
    )
}

/// Maquina de pila minima de PostScript, con lo justo para sacar contornos.
///
/// Los EPS de Illustrator abrevian todo (`/m {moveto} def`), asi que hay que
/// resolver esos alias: sin eso el archivo se ve como una lista de operadores
/// desconocidos y no sale ni una linea.
fn run_postscript(text: &str) -> (Vec<Vec<PathCmd>>, bool) {
    use std::collections::HashMap;

    let tokens = tokenize_postscript(text);
    let mut aliases: HashMap<String, Vec<PsToken>> = HashMap::new();

    // Primera pasada: /nombre { cuerpo } def
    let mut i = 0;
    while i < tokens.len() {
        if let PsToken::Operator(name) = &tokens[i] {
            if let Some(stripped) = name.strip_prefix('/') {
                if matches!(tokens.get(i + 1), Some(PsToken::Operator(b)) if b == "{") {
                    let mut depth = 1;
                    let mut body = Vec::new();
                    let mut j = i + 2;
                    while j < tokens.len() && depth > 0 {
                        if let PsToken::Operator(t) = &tokens[j] {
                            if t == "{" {
                                depth += 1;
                            } else if t == "}" {
                                depth -= 1;
                                if depth == 0 {
                                    break;
                                }
                            }
                        }
                        body.push(tokens[j].clone());
                        j += 1;
                    }
                    // El cuerpo puede cerrarse con `def` o con `bind def`, que
                    // es como los escribe cairo
                    let closes_with_def = match tokens.get(j + 1) {
                        Some(PsToken::Operator(d)) if d == "def" => true,
                        Some(PsToken::Operator(d)) if d == "bind" => {
                            matches!(tokens.get(j + 2), Some(PsToken::Operator(d2)) if d2 == "def")
                        }
                        _ => false,
                    };
                    // Un cuerpo largo con control de flujo no se puede inlinear
                    // sin un interprete completo; los atajos de verdad son cortos
                    if body.len() <= 40 && closes_with_def && !has_control_flow(&body) {
                        aliases.insert(stripped.to_string(), body);
                    }
                    i = j + 1;
                    continue;
                }
            }
        }
        i += 1;
    }

    let mut ctx = PsContext::default();
    run_tokens(&tokens, &aliases, &mut ctx, 0);
    if !ctx.current.is_empty() {
        ctx.finish_path(true);
    }
    (ctx.out, ctx.had_text)
}

/// Un cuerpo con condicionales o bucles no se puede inlinear: se descarta el
/// alias en vez de ejecutarlo a medias.
fn has_control_flow(body: &[PsToken]) -> bool {
    body.iter().any(|t| match t {
        PsToken::Operator(op) => matches!(
            op.as_str(),
            "if" | "ifelse" | "for" | "forall" | "repeat" | "loop" | "exit" | "{" | "}"
        ),
        _ => false,
    })
}

#[derive(Default)]
struct PsContext {
    operands: Vec<f64>,
    ctm_stack: Vec<Matrix>,
    ctm: Option<Matrix>,
    out: Vec<Vec<PathCmd>>,
    current: Vec<PathCmd>,
    cursor: (f64, f64),
    start: (f64, f64),
    had_text: bool,
    in_def: usize,
}

impl PsContext {
    fn matrix(&self) -> Matrix {
        self.ctm.unwrap_or_else(Matrix::identity)
    }

    fn finish_path(&mut self, keep: bool) {
        if keep && !self.current.is_empty() {
            self.out.push(std::mem::take(&mut self.current));
        } else {
            self.current.clear();
        }
    }
}

fn run_tokens(
    tokens: &[PsToken],
    aliases: &std::collections::HashMap<String, Vec<PsToken>>,
    ctx: &mut PsContext,
    depth: usize,
) {
    if depth > 4 {
        return;
    }

    for token in tokens {
        match token {
            PsToken::Number(n) => ctx.operands.push(*n),
            PsToken::Other => {}
            PsToken::Operator(op) => {
                // El cuerpo de una definicion no se ejecuta al leerlo
                if op == "{" {
                    ctx.in_def += 1;
                    continue;
                }
                if op == "}" {
                    ctx.in_def = ctx.in_def.saturating_sub(1);
                    continue;
                }
                if ctx.in_def > 0 || op.starts_with('/') {
                    continue;
                }

                if let Some(body) = aliases.get(op.as_str()) {
                    run_tokens(body, aliases, ctx, depth + 1);
                    continue;
                }

                apply_ps_operator(op, ctx);
            }
        }
    }
}

fn apply_ps_operator(op: &str, ctx: &mut PsContext) {
    let m = ctx.matrix();
    let n = ctx.operands.len();

    // Cada operador consume lo suyo y deja el resto de la pila en pie. Vaciarla
    // entera parece inofensivo hasta que aparece un atajo como el `re` de
    // cairo, que arma el rectangulo apoyandose en lo que quedo abajo
    let consumed: usize = match op {
        "moveto" if n >= 2 => {
            let (x, y) = last2(&ctx.operands);
            let p = m.apply(x, y);
            if !ctx.current.is_empty() {
                // Un moveto abre subpath; se guarda aparte para no arrastrar
                // saltos en vacio dentro del contorno
                ctx.finish_path(true);
            }
            ctx.current.push(PathCmd::Move(p.0, p.1));
            ctx.cursor = p;
            ctx.start = p;
            2
        }
        "rmoveto" if n >= 2 => {
            let (dx, dy) = last2(&ctx.operands);
            let d = linear(&m, dx, dy);
            let p = (ctx.cursor.0 + d.0, ctx.cursor.1 + d.1);
            if !ctx.current.is_empty() {
                ctx.finish_path(true);
            }
            ctx.current.push(PathCmd::Move(p.0, p.1));
            ctx.cursor = p;
            ctx.start = p;
            2
        }
        "lineto" if n >= 2 => {
            let (x, y) = last2(&ctx.operands);
            let p = m.apply(x, y);
            ctx.current.push(PathCmd::Line(p.0, p.1));
            ctx.cursor = p;
            2
        }
        "rlineto" if n >= 2 => {
            let (dx, dy) = last2(&ctx.operands);
            let d = linear(&m, dx, dy);
            let p = (ctx.cursor.0 + d.0, ctx.cursor.1 + d.1);
            ctx.current.push(PathCmd::Line(p.0, p.1));
            ctx.cursor = p;
            2
        }
        "curveto" if n >= 6 => {
            let a = &ctx.operands[n - 6..];
            let c1 = m.apply(a[0], a[1]);
            let c2 = m.apply(a[2], a[3]);
            let to = m.apply(a[4], a[5]);
            ctx.current.push(PathCmd::Cubic(c1.0, c1.1, c2.0, c2.1, to.0, to.1));
            ctx.cursor = to;
            6
        }
        "rcurveto" if n >= 6 => {
            let a = &ctx.operands[n - 6..];
            let (d1, d2, d3) = (
                linear(&m, a[0], a[1]),
                linear(&m, a[2], a[3]),
                linear(&m, a[4], a[5]),
            );
            let c1 = (ctx.cursor.0 + d1.0, ctx.cursor.1 + d1.1);
            let c2 = (ctx.cursor.0 + d2.0, ctx.cursor.1 + d2.1);
            let to = (ctx.cursor.0 + d3.0, ctx.cursor.1 + d3.1);
            ctx.current.push(PathCmd::Cubic(c1.0, c1.1, c2.0, c2.1, to.0, to.1));
            ctx.cursor = to;
            6
        }
        "closepath" => {
            if !ctx.current.is_empty() {
                ctx.current.push(PathCmd::Close);
                ctx.cursor = ctx.start;
            }
            0
        }
        "newpath" => {
            ctx.finish_path(false);
            0
        }
        "stroke" => {
            ctx.finish_path(true);
            0
        }
        "fill" | "eofill" => {
            close_subpaths(&mut ctx.current);
            ctx.finish_path(true);
            0
        }
        "clip" | "eoclip" | "rectclip" => {
            // El recorte de pagina no es geometria de la pieza
            ctx.finish_path(false);
            usize::MAX
        }
        "gsave" => {
            ctx.ctm_stack.push(m);
            0
        }
        "grestore" => {
            if let Some(prev) = ctx.ctm_stack.pop() {
                ctx.ctm = Some(prev);
            }
            0
        }
        "translate" if n >= 2 => {
            let (tx, ty) = last2(&ctx.operands);
            ctx.ctm = Some(Matrix([1.0, 0.0, 0.0, 1.0, tx, ty]).then(&m));
            2
        }
        "scale" if n >= 2 => {
            let (sx, sy) = last2(&ctx.operands);
            ctx.ctm = Some(Matrix([sx, 0.0, 0.0, sy, 0.0, 0.0]).then(&m));
            2
        }
        "rotate" if n >= 1 => {
            let deg = ctx.operands[n - 1];
            let (sn, cs) = (deg.to_radians().sin(), deg.to_radians().cos());
            ctx.ctm = Some(Matrix([cs, sn, -sn, cs, 0.0, 0.0]).then(&m));
            1
        }
        "concat" if n >= 6 => {
            let a = &ctx.operands[n - 6..];
            ctx.ctm = Some(Matrix([a[0], a[1], a[2], a[3], a[4], a[5]]).then(&m));
            6
        }
        "show" | "ashow" | "widthshow" | "awidthshow" | "kshow" => {
            ctx.had_text = true;
            usize::MAX
        }

        // Operadores de pila y aritmetica: sin ellos no corren los atajos que
        // definen los generadores. El `re` de cairo arma el rectangulo con
        // exch/dup/neg/roll antes de trazar nada
        "exch" if n >= 2 => {
            ctx.operands.swap(n - 1, n - 2);
            0
        }
        "dup" if n >= 1 => {
            ctx.operands.push(ctx.operands[n - 1]);
            0
        }
        "pop" if n >= 1 => 1,
        "neg" if n >= 1 => {
            ctx.operands[n - 1] = -ctx.operands[n - 1];
            0
        }
        "add" | "sub" | "mul" | "div" if n >= 2 => {
            let b = ctx.operands[n - 1];
            let a = ctx.operands[n - 2];
            let r = match op {
                "add" => a + b,
                "sub" => a - b,
                "mul" => a * b,
                _ => if b == 0.0 { 0.0 } else { a / b },
            };
            ctx.operands.truncate(n - 2);
            ctx.operands.push(r);
            0
        }
        "index" if n >= 1 => {
            let idx = ctx.operands[n - 1] as usize;
            ctx.operands.pop();
            let len = ctx.operands.len();
            if idx < len {
                ctx.operands.push(ctx.operands[len - 1 - idx]);
            }
            0
        }
        "copy" if n >= 1 => {
            let count = ctx.operands[n - 1] as usize;
            ctx.operands.pop();
            let len = ctx.operands.len();
            if count <= len {
                for i in 0..count {
                    ctx.operands.push(ctx.operands[len - count + i]);
                }
            }
            0
        }
        // n j roll: rota los n de arriba j lugares
        "roll" if n >= 2 => {
            let j = ctx.operands[n - 1] as i64;
            let count = ctx.operands[n - 2] as usize;
            ctx.operands.truncate(n - 2);
            let len = ctx.operands.len();
            if count > 0 && count <= len {
                let start = len - count;
                let shift = (((j % count as i64) + count as i64) as usize) % count;
                ctx.operands[start..].rotate_right(shift);
            }
            0
        }
        // `n array astore` reserva y rellena: para una pila de numeros alcanza
        // con descartar el tamaño y dejar los valores donde estan
        "array" if n >= 1 => 1,
        // No tocan la pila: `astore` y `aload` empaquetan y desempaquetan, y
        // como los arrays aca son los mismos numeros sueltos, no hay nada que
        // hacer. Vaciar en `astore` dejaba a `concat` sin matriz y el dibujo
        // entraba espejado
        "astore" | "aload" | "bind" => 0,

        // Estos si consumen lo suyo, y dejarlo en la pila envenena el proximo
        // moveto con coordenadas que eran un color o un ancho de linea
        "setlinewidth" | "setlinecap" | "setlinejoin" | "setmiterlimit" | "setgray" => 1,
        "setrgbcolor" => 3,
        "setcmykcolor" => 4,
        "setdash" | "showpage" | "restore" | "save" => usize::MAX,

        // Cualquier otra cosa: se limpia la pila. Es lo prudente — un operador
        // desconocido que dejaba sus argumentos ahi arruinaba el siguiente
        // moveto con coordenadas ajenas
        _ => usize::MAX,
    };

    if consumed == usize::MAX {
        ctx.operands.clear();
    } else if consumed > 0 {
        let keep = ctx.operands.len().saturating_sub(consumed);
        ctx.operands.truncate(keep);
    }
}

/// Aplica solo la parte lineal de la matriz: para desplazamientos relativos la
/// traslacion no corresponde.
fn linear(m: &Matrix, dx: f64, dy: f64) -> (f64, f64) {
    let a = m.0;
    (a[0] * dx + a[2] * dy, a[1] * dx + a[3] * dy)
}

// ============================================
// SALIDA
// ============================================

/// Comando SVG ya convertido: la letra y sus puntos en mm.
type SvgCmd = (String, Vec<(f64, f64)>);

fn build_result(
    subpaths: Vec<Vec<PathCmd>>,
    page: PageBox,
    format: VectorFormat,
    had_text: bool,
) -> VectorImportResult {
    // De puntos con Y hacia arriba a mm con Y hacia abajo, que es como se
    // dibuja un SVG
    let to_svg = |x: f64, y: f64| (x * MM_PER_POINT, (page.y_top - y) * MM_PER_POINT);

    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    let mut track = |p: (f64, f64)| {
        min_x = min_x.min(p.0);
        min_y = min_y.min(p.1);
        max_x = max_x.max(p.0);
        max_y = max_y.max(p.1);
    };

    let converted: Vec<Vec<SvgCmd>> = subpaths
        .iter()
        .map(|cmds| {
            cmds.iter()
                .map(|cmd| match cmd {
                    PathCmd::Move(x, y) => ("M".to_string(), vec![to_svg(*x, *y)]),
                    PathCmd::Line(x, y) => ("L".to_string(), vec![to_svg(*x, *y)]),
                    PathCmd::Cubic(a, b, c, d, e, f) => (
                        "C".to_string(),
                        vec![to_svg(*a, *b), to_svg(*c, *d), to_svg(*e, *f)],
                    ),
                    PathCmd::Close => ("Z".to_string(), vec![]),
                })
                .collect()
        })
        .collect();

    for path in &converted {
        for (_, pts) in path {
            for p in pts {
                track(*p);
            }
        }
    }

    if !min_x.is_finite() {
        min_x = 0.0;
        min_y = 0.0;
        max_x = 0.0;
        max_y = 0.0;
    }

    let width_mm = (max_x - min_x).max(0.001);
    let height_mm = (max_y - min_y).max(0.001);

    let mut point_count = 0;
    let mut d_paths = Vec::with_capacity(converted.len());
    for path in &converted {
        let mut d = String::new();
        for (op, pts) in path {
            if op == "Z" {
                d.push_str(" Z");
                continue;
            }
            if !d.is_empty() {
                d.push(' ');
            }
            d.push_str(op);
            for p in pts {
                let _ = write!(d, " {:.3} {:.3}", p.0 - min_x, p.1 - min_y);
                point_count += 1;
            }
        }
        if !d.trim().is_empty() {
            d_paths.push(d.trim().to_string());
        }
    }

    let mut svg = String::new();
    let _ = write!(
        svg,
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="{:.3}mm" height="{:.3}mm" viewBox="0 0 {:.3} {:.3}">"#,
        width_mm, height_mm, width_mm, height_mm
    );
    for d in &d_paths {
        let _ = write!(
            svg,
            r##"<path d="{}" fill="none" stroke="#000000" stroke-width="0.2"/>"##,
            d
        );
    }
    svg.push_str("</svg>");

    VectorImportResult {
        svg,
        format,
        path_count: d_paths.len(),
        point_count,
        width_mm,
        height_mm,
        had_text,
        page_count: page.pages,
    }
}

// ============================================
// BUSQUEDA EN BYTES
// ============================================

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

trait RFindSeq {
    fn rfind_seq(&self, needle: &[u8]) -> Option<usize>;
}

impl RFindSeq for [u8] {
    fn rfind_seq(&self, needle: &[u8]) -> Option<usize> {
        if needle.is_empty() || self.len() < needle.len() {
            return None;
        }
        self.windows(needle.len()).rposition(|w| w == needle)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// PDF minimo, sin comprimir, con la geometria pedida en el content stream.
    fn tiny_pdf(content: &str) -> Vec<u8> {
        format!(
            "%PDF-1.4\n1 0 obj\n<< /Type /Page /MediaBox [ 0 0 200 100 ] >>\nendobj\n\
             2 0 obj\n<< /Length {} >>\nstream\n{}\nendstream\nendobj\n%%EOF",
            content.len(),
            content
        )
        .into_bytes()
    }

    fn tiny_eps(body: &str) -> Vec<u8> {
        format!(
            "%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 200 100\n%%EndComments\n{}\nshowpage\n",
            body
        )
        .into_bytes()
    }

    /// PDF con arbol de paginas: `pages` son (contenido, extras del dict).
    fn paged_pdf(pages: &[(&str, &str)], extra_objs: &str) -> Vec<u8> {
        let mut out = String::from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
        let kids: Vec<String> = (0..pages.len()).map(|i| format!("{} 0 R", 10 + i * 2)).collect();
        out += &format!(
            "2 0 obj\n<< /Type /Pages /Kids [ {} ] /Count {} /MediaBox [ 0 0 200 100 ] >>\nendobj\n",
            kids.join(" "),
            pages.len()
        );
        for (i, (content, extra)) in pages.iter().enumerate() {
            let id = 10 + i * 2;
            out += &format!(
                "{} 0 obj\n<< /Type /Page /Parent 2 0 R /Contents {} 0 R {} >>\nendobj\n",
                id,
                id + 1,
                extra
            );
            out += &format!(
                "{} 0 obj\n<< /Length {} >>\nstream\n{}\nendstream\nendobj\n",
                id + 1,
                content.len(),
                content
            );
        }
        out += extra_objs;
        out += "%%EOF";
        out.into_bytes()
    }

    #[test]
    fn pdf_multipagina_importa_solo_la_primera() {
        let pdf = paged_pdf(&[("0 0 72 72 re S", ""), ("0 0 144 144 re S", "")], "");
        let res = import_vector_bytes(&pdf).unwrap();
        assert_eq!(res.path_count, 1);
        assert!((res.width_mm - 25.4).abs() < 0.01, "ancho {}", res.width_mm);
    }

    #[test]
    fn pdf_dibuja_los_form_xobjects_con_su_matriz() {
        let form = "0 0 72 72 re S";
        let extra = format!(
            "30 0 obj\n<< /Type /XObject /Subtype /Form /Matrix [ 2 0 0 1 0 0 ] /Length {} >>\nstream\n{}\nendstream\nendobj\n",
            form.len(),
            form
        );
        let pdf = paged_pdf(
            &[("q /Fm0 Do Q", "/Resources << /XObject << /Fm0 30 0 R >> >>")],
            &extra,
        );
        let res = import_vector_bytes(&pdf).unwrap();
        assert_eq!(res.path_count, 1);
        // La matriz del form duplica el ancho: 144pt = 50.8mm
        assert!((res.width_mm - 50.8).abs() < 0.01, "ancho {}", res.width_mm);
        assert!((res.height_mm - 25.4).abs() < 0.01, "alto {}", res.height_mm);
    }

    #[test]
    fn pdf_respeta_la_rotacion_de_pagina() {
        // 144x72 apaisado en una pagina girada 90: tiene que entrar parado
        let pdf = paged_pdf(&[("0 0 144 72 re S", "/Rotate 90")], "");
        let res = import_vector_bytes(&pdf).unwrap();
        assert!((res.width_mm - 25.4).abs() < 0.01, "ancho {}", res.width_mm);
        assert!((res.height_mm - 50.8).abs() < 0.01, "alto {}", res.height_mm);
    }

    #[test]
    fn pdf_rectangulo_sale_con_su_tamaño_en_mm() {
        // 144x72 puntos = 50.8 x 25.4 mm
        let pdf = tiny_pdf("10 10 144 72 re S");
        let res = import_vector_bytes(&pdf).unwrap();

        assert_eq!(res.format, VectorFormat::Pdf);
        assert_eq!(res.path_count, 1);
        assert!((res.width_mm - 50.8).abs() < 0.01, "ancho {}", res.width_mm);
        assert!((res.height_mm - 25.4).abs() < 0.01, "alto {}", res.height_mm);
        assert!(res.svg.contains(" Z"), "el rectangulo cierra");
    }

    #[test]
    fn pdf_aplica_la_matriz_cm() {
        // La misma linea, con y sin escala al doble
        let plano = import_vector_bytes(&tiny_pdf("0 0 m 72 0 l S")).unwrap();
        let escalado = import_vector_bytes(&tiny_pdf("q 2 0 0 2 0 0 cm 0 0 m 72 0 l S Q")).unwrap();
        assert!((plano.width_mm - 25.4).abs() < 0.01);
        assert!((escalado.width_mm - 50.8).abs() < 0.01, "cm no se aplico: {}", escalado.width_mm);
    }

    #[test]
    fn pdf_descarta_el_rectangulo_de_recorte() {
        // `W n` es recorte, no dibujo; la linea si tiene que quedar
        let pdf = tiny_pdf("0 0 200 100 re W n 10 10 m 100 10 l S");
        let res = import_vector_bytes(&pdf).unwrap();
        assert_eq!(res.path_count, 1, "solo la linea");
    }

    #[test]
    fn pdf_avisa_cuando_hay_texto() {
        let pdf = tiny_pdf("BT /F1 12 Tf 10 10 Td (hola) Tj ET 10 10 m 100 10 l S");
        let res = import_vector_bytes(&pdf).unwrap();
        assert!(res.had_text, "el texto no se importa pero hay que avisarlo");
        assert_eq!(res.path_count, 1);
    }

    #[test]
    fn pdf_cifrado_no_devuelve_basura() {
        let mut pdf = b"%PDF-1.4\n<< /Encrypt 5 0 R >>\n".to_vec();
        pdf.extend_from_slice(&tiny_pdf("10 10 m 100 10 l S")[8..]);
        let err = import_vector_bytes(&pdf).unwrap_err();
        assert!(err.contains("cifrado"), "mensaje: {}", err);
    }

    #[test]
    fn eps_resuelve_los_atajos_con_bind_def() {
        // Como los escribe cairo: /m {moveto} bind def
        let eps = tiny_eps(
            "/m { moveto } bind def\n/l { lineto } bind def\n/S { stroke } bind def\n\
             0 0 m 72 0 l S",
        );
        let res = import_vector_bytes(&eps).unwrap();
        assert_eq!(res.format, VectorFormat::Eps);
        assert_eq!(res.path_count, 1);
        assert!((res.width_mm - 25.4).abs() < 0.01);
    }

    #[test]
    fn eps_corre_los_operadores_de_pila_del_atajo_re() {
        // El `re` de cairo arma el rectangulo con exch/dup/neg/roll
        let eps = tiny_eps(
            "/re { exch dup neg 3 1 roll 5 3 roll moveto 0 rlineto 0 exch rlineto 0 rlineto closepath } bind def\n\
             10 10 144 72 re stroke",
        );
        let res = import_vector_bytes(&eps).unwrap();
        assert_eq!(res.path_count, 1);
        assert!((res.width_mm - 50.8).abs() < 0.05, "ancho {}", res.width_mm);
        assert!((res.height_mm - 25.4).abs() < 0.05, "alto {}", res.height_mm);
    }

    #[test]
    fn eps_un_color_no_se_cuela_como_coordenada() {
        // setrgbcolor deja 3 numeros: si no se consumen, el moveto siguiente
        // dibuja en cualquier parte
        let eps = tiny_eps("1 0 0 setrgbcolor 0 0 moveto 72 0 lineto stroke");
        let res = import_vector_bytes(&eps).unwrap();
        assert_eq!(res.path_count, 1);
        assert!((res.width_mm - 25.4).abs() < 0.01, "ancho {}", res.width_mm);
    }

    #[test]
    fn eps_traslada_con_translate() {
        let sin = import_vector_bytes(&tiny_eps("0 0 moveto 72 0 lineto stroke")).unwrap();
        let con = import_vector_bytes(&tiny_eps("50 20 translate 0 0 moveto 72 0 lineto stroke")).unwrap();
        // La traslacion no cambia el tamaño, y el contenido se normaliza al origen
        assert!((sin.width_mm - con.width_mm).abs() < 0.01);
    }

    #[test]
    fn formato_desconocido_avisa() {
        let err = import_vector_bytes(b"esto no es un vector").unwrap_err();
        assert!(err.contains("Formato no reconocido"), "mensaje: {}", err);
    }

    #[test]
    fn archivo_sin_geometria_avisa() {
        let err = import_vector_bytes(&tiny_eps("% nada que dibujar")).unwrap_err();
        assert!(err.contains("geometria"), "mensaje: {}", err);
    }

    /// Smoke con archivos reales: VECTOR_IN=archivo [VECTOR_OUT=salida.svg]
    #[test]
    #[ignore]
    fn smoke_archivo() {
        let input = std::env::var("VECTOR_IN").unwrap();
        let bytes = std::fs::read(&input).unwrap();
        let t0 = std::time::Instant::now();
        let res = import_vector_bytes(&bytes).unwrap();
        println!(
            "formato={:?} paths={} puntos={} {:.2}x{:.2}mm texto={} en {:?}",
            res.format, res.path_count, res.point_count, res.width_mm, res.height_mm,
            res.had_text, t0.elapsed()
        );
        if let Ok(out) = std::env::var("VECTOR_OUT") {
            std::fs::write(out, res.svg).unwrap();
        }
    }
}
