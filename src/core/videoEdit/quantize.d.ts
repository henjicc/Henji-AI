declare module 'quantize' {
  interface ColorMap { palette(): number[][]; map(color: number[]): number[] }
  export default function quantize(pixels: number[][], maxColors: number): ColorMap | false
}
