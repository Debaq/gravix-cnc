import opentype, { type Font } from 'opentype.js'
import { PIXELS_PER_MM } from './units'

export type { Font }

export interface FontInfo {
  name: string
  url: string
}

const AVAILABLE_FONTS: FontInfo[] = [
  { name: 'Roboto', url: '/fonts/Roboto.ttf' },
  { name: 'Open Sans', url: '/fonts/OpenSans.ttf' },
  { name: 'Roboto Mono', url: '/fonts/RobotoMono.ttf' },
]

const fontCache = new Map<string, Font>()

export function getAvailableFonts(): FontInfo[] {
  return AVAILABLE_FONTS
}

export async function loadFont(url: string): Promise<Font> {
  const cached = fontCache.get(url)
  if (cached) return cached

  const font = await opentype.load(url)
  fontCache.set(url, font)
  return font
}

export function textToSvgPath(
  text: string,
  font: Font,
  sizeMm: number,
  letterSpacing = 0,
  pixelsPerMm = PIXELS_PER_MM,
): string {
  const sizePx = sizeMm * pixelsPerMm
  const spacingPx = letterSpacing * pixelsPerMm
  // `getPath` ignora los saltos de linea: cada renglon se traza por separado
  // y baja un interlineado (antes todo el texto salia en un solo renglon).
  const lineHeight = sizePx * 1.2
  return text
    .split(/\r?\n/)
    .map((line, i) =>
      line.trim() === ''
        ? ''
        : font
            .getPath(line, 0, sizePx + i * lineHeight, sizePx, { letterSpacing: spacingPx / sizePx })
            .toPathData(2),
    )
    .filter(Boolean)
    .join(' ')
}

