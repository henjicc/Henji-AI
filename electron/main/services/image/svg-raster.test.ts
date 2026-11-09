import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'

import { rasterizeSvgIfNeeded } from './svg-raster'

let dir: string | undefined
afterEach(async () => { if (dir) await fs.rm(dir, { recursive: true, force: true }) })

describe('SVG 转 PNG', () => {
  it('SVG 按长边 2048 渲染成 PNG 并复用缓存，其他格式原样返回', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'svg-raster-'))
    const svg = path.join(dir, 'logo.svg')
    await fs.writeFile(svg, '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="red"/></svg>')
    const cache = path.join(dir, 'cache')
    const png = await rasterizeSvgIfNeeded(svg, cache)
    expect(png.endsWith('.png')).toBe(true)
    expect(await sharp(png).metadata()).toMatchObject({ format: 'png', width: 2048, height: 1024 })
    expect(await rasterizeSvgIfNeeded(svg, cache)).toBe(png)
    const plain = path.join(dir, 'a.png')
    expect(await rasterizeSvgIfNeeded(plain, cache)).toBe(plain)
    const broken = path.join(dir, 'broken.svg')
    await fs.writeFile(broken, 'not svg')
    await expect(rasterizeSvgIfNeeded(broken, cache)).rejects.toThrow(/SVG 文件无法解析/)
  })
})
