import type { CodeDrawCommand } from '@/core/videoEdit/codeMaterial/contract'

interface RasterBox { x: number; y: number; width: number; height: number; resolution?: number }
/** Only a Canvas2D oracle, never application/Electron acceptance or a GPU benchmark. */
export async function createCanvasOracle(): Promise<{ raster: (command: CodeDrawCommand, box: RasterBox) => Promise<OffscreenCanvas>; dispose: () => Promise<void> }> {
  // 只有显式开启 Canvas 对照时才加载浏览器与打包器，普通 GPU CI 不引入它们。
  const [{ build }, { chromium }] = await Promise.all([import('esbuild'), import('playwright')])
  const bundle = await build({ stdin: { contents: `import {rasterizeCodeShape} from './src/features/videoEdit/engine/videoEditCodeRaster'; globalThis.t108Raster=rasterizeCodeShape;`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', platform: 'browser', loader: { '.wgsl': 'text' }, logLevel: 'silent' })
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.addScriptTag({ content: bundle.outputFiles[0].text })
    return {
      raster: async (command, box) => {
        const result = await page.evaluate(({ command, box }) => {
          const host = globalThis as unknown as { t108Raster: (command: CodeDrawCommand, box: RasterBox) => OffscreenCanvas }
          const canvas = host.t108Raster(command, box)
          const context = canvas.getContext('2d')!
          const bytes = context.getImageData(0, 0, canvas.width, canvas.height).data
          let binary = ''
          for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384))
          return { pixels: btoa(binary), width: canvas.width, height: canvas.height }
        }, { command, box })
        const pixels = Buffer.from(result.pixels, 'base64')
        for (let i = 0; i < pixels.length; i += 4) for (let c = 0; c < 3; c++) pixels[i + c] = Math.round(pixels[i + c] * pixels[i + 3] / 255)
        return { ...result, pixels } as unknown as OffscreenCanvas
      },
      dispose: () => browser.close(),
    }
  } catch (error) { await browser.close(); throw error }
}
