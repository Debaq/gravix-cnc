# Desbaste adaptativo: cuellos de material

> **Estado: abierto.** El desbaste adaptativo (`src/lib/adaptive.ts`) funciona y
> mantiene la carga en el objetivo en el 75% de los pasos, pero un 3–9% queda
> cerca del ranurado. Este documento registra qué pasa, por qué, qué se probó y
> qué haría falta para sacarlo del todo.

## El síntoma

En un bolsillo de 120×80 con fresa de ø6 y ancho radial objetivo de 0.72 mm
(12% del diámetro, arco de contacto objetivo 81°), sobre 4012 pasos:

| arco de contacto / objetivo | pasos | |
|---|---|---|
| 0.00 – 0.75 | 722 | la fresa entra o sale de material |
| 0.75 – 1.25 | **2998 (75%)** | régimen normal |
| 1.25 – 1.50 | 131 | rincones |
| 1.50 – 1.75 | 19 | |
| **1.75 – 2.25** | **142 (3.5%)** | **cuellos** |

El histograma es **bimodal**: entre 1.5 y 1.75 casi no hay nada (19 pasos) y
después aparece un grupo de 142. Eso no es la cola de una distribución: es un
mecanismo distinto. En esos pasos el arco de contacto llega a 170–180°, o sea
ranurado, y a profundidad de pasada completa eso rompe fresas.

En el bolsillo con isla y en la forma en L el mismo grupo llega al 8–9% de los
pasos.

## Qué es un cuello

El marchador avanza libre: en cada paso elige la curvatura que deja el arco de
contacto en el objetivo. No propaga un frente ordenado. Cuando termina una
pasada y reengancha en otro lado, el recorrido nuevo puede acercarse a una zona
que ya se vació dejando una pared de material entre las dos:

```
   ░░░░ ya vaciado ░░░░
   ░░░░░░░░░░░░░░░░░░░░
   ████ ← el cuello, 2–4 mm de material
   ░░░░░░░░░░░░░░░░░░░░   ← por acá viene la fresa
```

Romper esa pared es ranurar: la fresa agarra material por los dos lados a la
vez. No hay curvatura que lo evite una vez que está adentro — la pared la tiene
rodeada.

Los cuellos aparecen a 5–20 mm de la pared (no contra el borde) y a un 30% del
largo de su pasada (no en el arranque), que es lo que se espera de material que
quedó entre dos recorridos y no de un problema de entrada.

## Por qué las guardas no alcanzan

El controlador ya rechaza pasos peligrosos con cuatro criterios. Ninguno ataca
el cuello por una razón de fondo distinta en cada caso:

1. **Pico del tramo** (`peak > 1.5× objetivo`). Mide el paso que se está por
   dar. Cuando el pico salta, la fresa ya está contra la pared.

2. **Escape** (4 pasos girando en contra tienen que quedar dentro de los
   límites). Protege de clavarse contra la pared del bolsillo, no del material
   que queda en el medio.

3. **Anticipación** (`AHEAD_STEPS` pasos adelante con la misma curvatura). Acá
   está la trampa: la anticipación descuenta el barrido que los propios pasos
   van a sacar, porque sin ese descuento sobreestima siempre y el marchador
   termina esquivando su propia viruta — el bocado cae a la mitad (ae 0.36 de
   0.72 pedidos). Pero **el cuello cae justo dentro de ese barrido**, así que el
   descuento lo borra de la medición. Descontar y detectar el cuello son
   incompatibles mirando sólo el ángulo.

4. **Contacto partido** (`split`: material a los dos lados a la vez). Es la
   firma geométrica del cuello y sobrevive al descuento. Bajó el grupo de 184 a
   120 pasos, pero llega tarde: cuando el contacto se parte, la fresa ya entró.

## Barrido de parámetros

Se midieron las 12 combinaciones de `AHEAD_STEPS` × `AHEAD_CEILING` sobre el
bolsillo de 120×80 (medio = arco de contacto promedio contra 81° de objetivo;
over = pasos sobre 1.25× el objetivo):

| pasos | techo | medio | pico | over | largo | pasadas |
|---|---|---|---|---|---|---|
| 1 | 1.5 | 70° | 165° | 5.1% | 3.13 m | 215 |
| 1 | 1.8 | 76° | 185° | 12.3% | 2.96 m | 136 |
| 1 | 2.2 | 76° | 175° | 12.3% | 2.93 m | 131 |
| **2** | **1.8** | **72°** | **170°** | **7.3%** | **3.01 m** | **175** |
| 2 | 1.5 | 68° | 175° | 3.4% | 3.28 m | 220 |
| 2 | 2.2 | 76° | 175° | 12.3% | 2.93 m | 131 |
| 3 | 1.5 | 60° | 165° | 2.1% | 3.49 m | 472 |
| 3 | 1.8 | 67° | 170° | 3.8% | 3.31 m | 244 |
| 4 | 1.5 | 59° | 165° | 1.3% | 3.68 m | 487 |
| 4 | 1.8 | 65° | 170° | 3.7% | 3.43 m | 273 |

Dos conclusiones:

- **El pico nunca baja de 165°**, en ninguna combinación. Anticipar más no
  elimina el cuello: sólo cambia cuántos pasos se comen la pared.
- Hay un intercambio limpio entre bocado y carga: bajar el techo baja los
  excedidos pero también el bocado medio y alarga el recorrido (a 4 pasos con
  techo 1.5, el bocado cae al 73% del objetivo y el recorrido crece 22%).

Los valores elegidos (2 pasos, techo 1.8) están en la rodilla: 89% del bocado
pedido con 7.3% de pasos excedidos.

## Mitigación actual

Cada pasada devuelve el arco de contacto punto por punto:

```ts
interface AdaptivePass {
  points: Point2D[]
  engagement: Float32Array  // radianes, mismo largo que points
}
```

El post tiene que bajar el avance donde la carga se pasa, escalando por la
relación de anchos radiales:

```ts
const ae = radialWidthFromAngle(pass.engagement[i], toolRadius)
const factor = Math.min(1, targetRadialWidth / Math.max(ae, 1e-6))
```

Es la misma corrección que se aplica al revés con `chipThinningFactor` cuando el
bocado es chico. Sin esto el recorrido **no es seguro** a profundidad completa:
el 3.5% de pasos a 170° pasa de ser un problema de tiempo a ser un problema de
fresas rotas.

`AdaptiveResult.stats.overloadedSteps` cuenta los pasos donde ninguna curvatura
entraba en el techo, para avisar en la UI.

## El arreglo de verdad

El cuello no es un bug del controlador: es consecuencia de que el marchador sea
libre. Un frente que avanza como offset sucesivo de la zona ya vaciada no puede
dejar material atrás, porque por construcción avanza de manera monótona sobre un
frente conexo. Eso es lo que hacen los adaptativos comerciales.

Pasar a ese esquema implica:

- llevar el borde de la zona vaciada como curva, no sólo como grilla;
- ordenar el avance por ese frente en vez de por cercanía al punto anterior
  (hoy `findReentry` elige el reenganche más cercano);
- resolver las particiones del frente cuando una región se parte en dos
  (`MaterialField.regions()` ya las detecta, pero nadie las usa para ordenar).

Es un rediseño del generador, no una guarda más. Mientras tanto el recorrido
sirve para desbaste con el avance modulado.

## Cómo medir

Sobre el resultado de `generateAdaptivePath`, con `targetAngle =
angleFromRadialWidth(targetRadialWidth, toolRadius)`:

```ts
const hist = new Array(10).fill(0)
for (const p of res.passes) {
  for (let i = 1; i < p.engagement.length; i++) {
    hist[Math.min(9, Math.floor((p.engagement[i] / targetAngle) * 4))]++
  }
}
```

Si el bin 7 (1.75–2.00) se separa del bin 6 con un valle en el medio, el
problema sigue ahí. Si la distribución queda con una cola que decae, el frente
ordenado funcionó.
