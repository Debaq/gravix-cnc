/// <reference types="vite/client" />

declare module 'opentype.js' {
  export interface Font {
    getPath(text: string, x: number, y: number, fontSize: number, options?: Record<string, unknown>): Path
    unitsPerEm: number
  }
  export interface Path {
    toPathData(decimalPlaces?: number): string
    getBoundingBox(): { x1: number; y1: number; x2: number; y2: number }
  }
  export function load(url: string): Promise<Font>
  const opentype: { load: typeof load }
  export default opentype
}
