import opentype, { type Font } from 'opentype.js'

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
  pixelsPerMm = 3.78,
): string {
  const sizePx = sizeMm * pixelsPerMm
  const spacingPx = letterSpacing * pixelsPerMm
  const path = font.getPath(text, 0, sizePx, sizePx, { letterSpacing: spacingPx / sizePx })
  return path.toPathData(2)
}

