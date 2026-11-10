import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'

/** 位图消费方（供应商上传、图片编辑器）都只收 PNG/JPEG/WebP；SVG 先按长边 2048 渲染成 PNG。 */
const RASTER_LONG_SIDE = 2048
const DEFAULT_CACHE_DIR = path.join(os.tmpdir(), 'henji-svg-raster')
/** 同一文件并发首次使用（多处参考同一张、上传前先探测）共用一次渲染，避免互相覆盖正在读取的缓存。 */
const pending = new Map<string, Promise<string>>()

function isSvgPath(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === '.svg'
}

/** 非 SVG 原样返回；SVG 按“路径 + 修改时间 + 大小”缓存渲染结果，同一文件反复使用不重复渲染。 */
export async function rasterizeSvgIfNeeded(filePath: string, cacheDir = DEFAULT_CACHE_DIR): Promise<string> {
  if (!isSvgPath(filePath)) return filePath
  const stats = await fs.stat(filePath)
  const key = createHash('sha256').update(`${filePath}\0${stats.mtimeMs}\0${stats.size}`).digest('hex').slice(0, 32)
  const target = path.join(cacheDir, `${key}.png`)
  const running = pending.get(target)
  if (running) return await running
  const task = render(filePath, target).finally(() => pending.delete(target))
  pending.set(target, task)
  return await task
}

async function render(filePath: string, target: string): Promise<string> {
  try {
    await fs.access(target)
    return target
  } catch { /* 未缓存，继续渲染 */ }
  let png: Buffer
  try {
    const bytes = await fs.readFile(filePath)
    const { width, height } = await sharp(bytes).metadata()
    const longSide = Math.max(width ?? 0, height ?? 0) || RASTER_LONG_SIDE
    // sharp 按 72 DPI 解释 SVG 的固有尺寸，按目标长边换算渲染密度，矢量放大不失真。
    const density = Math.min(72 * RASTER_LONG_SIDE / longSide, 72 * 32)
    png = await sharp(bytes, { density }).png().toBuffer()
  } catch (error) {
    throw new Error(`SVG 文件无法解析，可能已损坏：${path.basename(filePath)}`, { cause: error })
  }
  await fs.mkdir(path.dirname(target), { recursive: true })
  const temp = `${target}.${randomUUID()}.tmp`
  await fs.writeFile(temp, png)
  await fs.rename(temp, target)
  return target
}
