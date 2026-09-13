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
}

// ============================================
// PDF
// ============================================

fn parse_pdf(bytes: &[u8]) -> Result<(Vec<Vec<PathCmd>>, PageBox, bool), String> {
    if find(&bytes[..bytes.len().min(4096)], b"/Encrypt").is_some() {
        return Err("El PDF esta cifrado y no se puede leer".into());
    }

    let y_top = pdf_media_box_top(bytes).unwrap_or(842.0); // A4 por defecto
    let mut subpaths = Vec::new();
    let mut had_text = false;

    for content in pdf_content_streams(bytes) {
        let (paths, text) = parse_content_stream(&content);
        had_text |= text;
        subpaths.extend(paths);
    }

    Ok((subpaths, PageBox { y_top }, had_text))
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
    let text = String::from_utf8_lossy(data);
    let mut ctm = Matrix::identity();
    let mut stack: Vec<Matrix> = Vec::new();
    let mut operands: Vec<f64> = Vec::new();

    let mut out: Vec<Vec<PathCmd>> = Vec::new();
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
                match op.as_str() {
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
                            out.push(std::mem::take(&mut current));
                        } else {
                            current.clear();
                        }
                        pending_clip = false;
                    }
                    _ => {}
                }
                operands.clear();
            }
        }
    }

    (out, had_text)
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
    Ok((paths, PageBox { y_top }, had_text))
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
        "stroke" | "fill" | "eofill" => {
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
