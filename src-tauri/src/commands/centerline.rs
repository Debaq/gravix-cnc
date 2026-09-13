//! Trazado de eje medio (centerline): en vez del contorno de la tinta, la
//! linea que la recorre por el medio.
//!
//! Es lo que hace falta para line art de un solo trazo — un plano a lapiz, una
//! firma, letras de palo — donde el contorno devuelve dos lineas paralelas por
//! cada trazo y la maquina termina repasando el borde en vez de dibujarlo.
//!
//! El camino es: adelgazar la mancha a un esqueleto de un pixel (Zhang-Suen),
//! leerlo como grafo (extremos y bifurcaciones son nodos, el resto son tramos)
//! y sacar de ahi las polilineas.

use std::collections::HashSet;

/// Polilinea del esqueleto en coordenadas de pixel, con su condicion de cerrada.
pub struct Stroke {
    pub points: Vec<[f64; 2]>,
    pub closed: bool,
}

/// Los 8 vecinos en orden circular (N, NE, E, SE, S, SO, O, NO). El orden
/// importa: el conteo de transiciones 0->1 de Zhang-Suen lo recorre asi.
const NEIGHBORS: [(i32, i32); 8] = [
    (0, -1),
    (1, -1),
    (1, 0),
    (1, 1),
    (0, 1),
    (-1, 1),
    (-1, 0),
    (-1, -1),
];

/// Adelgaza la mascara a un esqueleto de un pixel de ancho.
///
/// Zhang-Suen borra en dos sub-pasadas de reglas complementarias; alternarlas
/// es lo que evita que un trazo de ancho par se corte al medio.
// Las condiciones van en la forma del paper (p2·p4·p6 y p4·p6·p8). Factorizarlas
// como pide clippy ahorra un termino y cuesta poder compararlas con el original
#[allow(clippy::nonminimal_bool)]
pub fn thin(mask: &[bool], w: usize, h: usize) -> Vec<bool> {
    let mut img = mask.to_vec();
    let mut to_delete: Vec<usize> = Vec::new();

    loop {
        let mut changed = false;

        for step in 0..2 {
            to_delete.clear();

            for y in 1..h.saturating_sub(1) {
                for x in 1..w.saturating_sub(1) {
                    let idx = y * w + x;
                    if !img[idx] {
                        continue;
                    }

                    let n: Vec<bool> = NEIGHBORS
                        .iter()
                        .map(|(dx, dy)| {
                            img[(y as i32 + dy) as usize * w + (x as i32 + dx) as usize]
                        })
                        .collect();

                    // B: vecinos encendidos. Con menos de 2 el pixel es una
                    // punta y con mas de 6 es interior de una zona gruesa
                    let b = n.iter().filter(|v| **v).count();
                    if !(2..=6).contains(&b) {
                        continue;
                    }

                    // A: transiciones apagado->encendido dando la vuelta. Con
                    // A != 1 el pixel une dos ramas y borrarlo parte el trazo
                    let a = (0..8)
                        .filter(|i| !n[*i] && n[(i + 1) % 8])
                        .count();
                    if a != 1 {
                        continue;
                    }

                    // Las dos condiciones que cambian entre sub-pasadas: cada
                    // una ataca un par de esquinas distinto
                    let (north, east, south, west) = (n[0], n[2], n[4], n[6]);
                    let keep = if step == 0 {
                        (north && east && south) || (east && south && west)
                    } else {
                        (north && east && west) || (north && south && west)
                    };
                    if keep {
                        continue;
                    }

                    to_delete.push(idx);
                }
            }

            if !to_delete.is_empty() {
                changed = true;
                for idx in &to_delete {
                    img[*idx] = false;
                }
            }
        }

        if !changed {
            break;
        }
    }

    img
}

/// Lee el esqueleto como grafo y devuelve sus tramos.
///
/// `prune` descarta ramas muertas mas cortas que ese largo en pixeles: la
/// esqueletizacion siempre deja pelitos donde el borde de la mancha tenia
/// irregularidades.
pub fn skeleton_to_strokes(skel: &[bool], w: usize, h: usize, prune: f64) -> Vec<Stroke> {
    let graph = Skeleton { pix: skel, deg: degrees(skel, w, h), w, h };
    let degree = &graph.deg;
    let mut visited: HashSet<(usize, usize)> = HashSet::new();
    // Un pixel de paso pertenece a un solo tramo. Sin esto, los cuatro vecinos
    // de una bifurcacion — que ya salieron cada uno en su rama — vuelven a
    // aparecer como un rombo cerrado alrededor del centro, porque entre ellos
    // hay aristas diagonales que nadie recorrio
    let mut used: HashSet<usize> = HashSet::new();
    let mut strokes = Vec::new();

    // Primero los tramos que arrancan en un nodo (extremo o bifurcacion)
    for idx in 0..skel.len() {
        if !skel[idx] || degree[idx] == 2 {
            continue;
        }
        for next in graph.neighbors(idx) {
            if visited.contains(&edge_key(idx, next)) || used.contains(&next) {
                continue;
            }
            let chain = walk(&graph, idx, next, &mut visited, &used);
            mark_used(&chain, degree, &mut used);

            let ends_free = degree[idx] == 1 || degree[*chain.last().unwrap()] == 1;
            let pts = to_points(&chain, w);
            if ends_free && polyline_length(&pts) < prune {
                continue;
            }
            strokes.push(Stroke { points: pts, closed: false });
        }
    }

    // Lo que quede son ciclos puros: todos sus pixeles tienen grado 2, asi que
    // ningun nodo los alcanzo
    for idx in 0..skel.len() {
        if !skel[idx] || degree[idx] != 2 || used.contains(&idx) {
            continue;
        }
        let start_next = graph
            .neighbors(idx)
            .into_iter()
            .find(|n| !visited.contains(&edge_key(idx, *n)) && !used.contains(n));
        let start_next = match start_next {
            Some(n) => n,
            None => continue,
        };

        let chain = walk(&graph, idx, start_next, &mut visited, &used);
        mark_used(&chain, degree, &mut used);

        let closed = chain.len() > 3 && chain.first() == chain.last();
        let mut pts = to_points(&chain, w);
        if closed {
            pts.pop(); // el cierre lo pone el Z, no un punto repetido
        }
        if pts.len() >= 3 && (closed || polyline_length(&pts) >= prune) {
            strokes.push(Stroke { points: pts, closed });
        }
    }

    strokes
}

/// Los pixeles de paso de la cadena quedan consumidos; los nodos de sus puntas
/// no, porque de ahi salen las otras ramas.
fn mark_used(chain: &[usize], degree: &[u8], used: &mut HashSet<usize>) {
    for idx in chain {
        if degree[*idx] == 2 {
            used.insert(*idx);
        }
    }
}

/// El esqueleto con su tabla de grados, que es lo que hace falta para recorrerlo.
struct Skeleton<'a> {
    pix: &'a [bool],
    deg: Vec<u8>,
    w: usize,
    h: usize,
}

impl Skeleton<'_> {
    fn neighbors(&self, idx: usize) -> Vec<usize> {
        neighbors_of(idx, self.pix, self.w, self.h)
    }
}

/// Grado de cada pixel del esqueleto por **numero de cruces**: transiciones
/// apagado->encendido dando la vuelta a los 8 vecinos.
///
/// Contar vecinos a secas no sirve: en una escalera diagonal un pixel de paso
/// tiene tres vecinos encendidos (el de antes, el de despues y la diagonal que
/// los toca a los dos) y se leeria como bifurcacion. Con el numero de cruces,
/// 1 es extremo, 2 es paso y 3 o mas es bifurcacion de verdad.
fn degrees(skel: &[bool], w: usize, h: usize) -> Vec<u8> {
    let mut deg = vec![0u8; skel.len()];
    for y in 0..h {
        for x in 0..w {
            let idx = y * w + x;
            if !skel[idx] {
                continue;
            }
            let ring: Vec<bool> = NEIGHBORS
                .iter()
                .map(|(dx, dy)| {
                    let (nx, ny) = (x as i32 + dx, y as i32 + dy);
                    if nx < 0 || ny < 0 || nx >= w as i32 || ny >= h as i32 {
                        false
                    } else {
                        skel[ny as usize * w + nx as usize]
                    }
                })
                .collect();
            deg[idx] = (0..8).filter(|i| !ring[*i] && ring[(i + 1) % 8]).count() as u8;
        }
    }
    deg
}

/// Vecinos encendidos, **ortogonales primero**: en una escalera, avanzar por la
/// diagonal saltea el pixel de la esquina y deja aristas sueltas atras.
fn neighbors_of(idx: usize, skel: &[bool], w: usize, h: usize) -> Vec<usize> {
    #[rustfmt::skip]
    const ORDERED: [(i32, i32); 8] = [
        (0, -1), (1, 0), (0, 1), (-1, 0),
        (1, -1), (1, 1), (-1, 1), (-1, -1),
    ];

    let x = (idx % w) as i32;
    let y = (idx / w) as i32;
    let mut out = Vec::with_capacity(8);
    for (dx, dy) in ORDERED {
        let (nx, ny) = (x + dx, y + dy);
        if nx < 0 || ny < 0 || nx >= w as i32 || ny >= h as i32 {
            continue;
        }
        let n = ny as usize * w + nx as usize;
        if skel[n] {
            out.push(n);
        }
    }
    out
}

/// Dos pixeles del esqueleto se tocan (8-conectividad).
fn adjacent(a: usize, b: usize, w: usize) -> bool {
    let (ax, ay) = ((a % w) as i32, (a / w) as i32);
    let (bx, by) = ((b % w) as i32, (b / w) as i32);
    (ax - bx).abs() <= 1 && (ay - by).abs() <= 1 && a != b
}

fn edge_key(a: usize, b: usize) -> (usize, usize) {
    if a < b {
        (a, b)
    } else {
        (b, a)
    }
}

/// Avanza desde `from` hacia `next` mientras los pixeles sean de paso (grado 2)
/// y devuelve la cadena completa, nodo a nodo.
fn walk(
    graph: &Skeleton,
    from: usize,
    next: usize,
    visited: &mut HashSet<(usize, usize)>,
    used: &HashSet<usize>,
) -> Vec<usize> {
    let w = graph.w;
    let mut chain = vec![from, next];
    let mut in_chain: HashSet<usize> = HashSet::from([from, next]);
    visited.insert(edge_key(from, next));

    let mut prev = from;
    let mut cur = next;
    while graph.deg[cur] == 2 {
        // Volver a un pixel que ya esta en la cadena corta el tramo por la
        // mitad: en las escaleras, el pixel de dos atras tambien es vecino
        let candidates: Vec<usize> = graph
            .neighbors(cur)
            .into_iter()
            .filter(|n| *n != prev && !visited.contains(&edge_key(cur, *n)))
            .filter(|n| *n == from || (!in_chain.contains(n) && !used.contains(n)))
            .collect();
        // El primero es el mas cercano (neighbors_of da ortogonales antes que
        // diagonales). Elegir el lejano saltea el pixel de la esquina en cada
        // escalera y lo deja suelto atras
        let step = match candidates.first().copied() {
            Some(s) => s,
            None => break,
        };
        visited.insert(edge_key(cur, step));
        chain.push(step);
        in_chain.insert(step);
        prev = cur;
        cur = step;
        if cur == from {
            break;
        }
    }

    // Las aristas entre pixeles de la cadena que no se recorrieron (las
    // diagonales de cada escalera) se dan por consumidas: si no, cada una
    // vuelve despues como un trazo suelto de un pixel
    for i in 0..chain.len() {
        for j in i + 1..chain.len() {
            if adjacent(chain[i], chain[j], w) {
                visited.insert(edge_key(chain[i], chain[j]));
            }
        }
    }

    chain
}

fn to_points(chain: &[usize], w: usize) -> Vec<[f64; 2]> {
    chain
        .iter()
        .map(|idx| [(idx % w) as f64, (idx / w) as f64])
        .collect()
}

fn polyline_length(pts: &[[f64; 2]]) -> f64 {
    pts.windows(2)
        .map(|s| ((s[1][0] - s[0][0]).powi(2) + (s[1][1] - s[0][1]).powi(2)).sqrt())
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn blank(w: usize, h: usize) -> Vec<bool> {
        vec![false; w * h]
    }

    fn fill_rect(m: &mut [bool], w: usize, x0: usize, y0: usize, x1: usize, y1: usize) {
        for y in y0..y1 {
            for x in x0..x1 {
                m[y * w + x] = true;
            }
        }
    }

    #[test]
    fn barra_gruesa_queda_en_una_linea_de_un_pixel() {
        let (w, h) = (40, 20);
        let mut m = blank(w, h);
        fill_rect(&mut m, w, 5, 8, 35, 13); // 30x5

        let skel = thin(&m, w, h);
        // Una sola fila encendida en el tramo central de la barra
        for x in 10..30 {
            let col: Vec<usize> = (0..h).filter(|y| skel[y * w + x]).collect();
            assert_eq!(col.len(), 1, "columna {} tiene {} pixeles", x, col.len());
        }

        let strokes = skeleton_to_strokes(&skel, w, h, 0.0);
        assert_eq!(strokes.len(), 1, "un solo trazo");
        assert!(!strokes[0].closed);
        assert!(
            polyline_length(&strokes[0].points) > 20.0,
            "el trazo deberia recorrer la barra"
        );
    }

    #[test]
    fn cruz_da_cuatro_ramas_desde_la_union() {
        let (w, h) = (41, 41);
        let mut m = blank(w, h);
        fill_rect(&mut m, w, 5, 19, 36, 22);
        fill_rect(&mut m, w, 19, 5, 22, 36);

        let skel = thin(&m, w, h);
        let strokes = skeleton_to_strokes(&skel, w, h, 2.0);
        assert_eq!(strokes.len(), 4, "cuatro brazos, ni uno mas");
        assert!(strokes.iter().all(|s| !s.closed));
        assert!(strokes.iter().all(|s| polyline_length(&s.points) > 8.0));
    }

    #[test]
    fn anillo_da_un_trazo_cerrado() {
        let (w, h) = (40, 40);
        let mut m = blank(w, h);
        for y in 0..h {
            for x in 0..w {
                let (dx, dy) = (x as f64 - 20.0, y as f64 - 20.0);
                let r = (dx * dx + dy * dy).sqrt();
                if (10.0..14.0).contains(&r) {
                    m[y * w + x] = true;
                }
            }
        }

        let skel = thin(&m, w, h);
        let strokes = skeleton_to_strokes(&skel, w, h, 3.0);
        assert_eq!(strokes.len(), 1, "el anillo es un unico trazo");
        assert!(strokes[0].closed, "y tiene que salir cerrado");
    }

    #[test]
    fn prune_borra_el_pelito_y_deja_el_trazo() {
        let (w, h) = (40, 20);
        let mut m = blank(w, h);
        fill_rect(&mut m, w, 5, 9, 35, 12);
        // Nub de 3 px colgando del medio
        fill_rect(&mut m, w, 20, 6, 23, 9);

        let skel = thin(&m, w, h);
        let sin_prune = skeleton_to_strokes(&skel, w, h, 0.0);
        let con_prune = skeleton_to_strokes(&skel, w, h, 6.0);
        assert!(
            con_prune.len() < sin_prune.len(),
            "el prune tiene que sacar la rama corta ({} -> {})",
            sin_prune.len(),
            con_prune.len()
        );
        assert!(!con_prune.is_empty(), "pero no el trazo principal");
    }

    #[test]
    fn dos_trazos_sueltos_no_se_mezclan() {
        let (w, h) = (40, 30);
        let mut m = blank(w, h);
        fill_rect(&mut m, w, 3, 5, 36, 8);
        fill_rect(&mut m, w, 3, 20, 36, 23);

        let skel = thin(&m, w, h);
        let strokes = skeleton_to_strokes(&skel, w, h, 2.0);
        assert_eq!(strokes.len(), 2);
    }
}
