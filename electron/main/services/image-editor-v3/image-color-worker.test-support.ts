import { build } from 'esbuild'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/** 定向测试使用正式 Worker 入口的临时 bundle，不依赖过期 Electron 产物。 */
export async function buildImageColorTestWorker(): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'henji-color-worker-test-'))
  const output = path.join(directory, 'image-color-lut-worker.cjs')
  await build({ entryPoints: [path.resolve('electron/main/image-color-lut-worker.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: output, logLevel: 'silent' })
  return { path: output, cleanup: () => fsp.rm(directory, { recursive: true, force: true }) }
}
