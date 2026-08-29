import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  readImageInfo,
  readPanoramaImageMetadata,
  savePanoramaImageSourceToDirectory,
  savePanoramaImageSourceToPath,
} from './ops'
import { loadSharp } from './sharp-loader'

function dataUrl(mime: string, bytes: Buffer): string {
  return `data:${mime};base64,${bytes.toString('base64')}`
}

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('readImageInfo', () => {
  it('读取透明通道并在没有 EXIF 方向时返回 null', async () => {
    const sharp = await loadSharp()
    const bytes = await sharp({
      create: {
        width: 12,
        height: 8,
        channels: 4,
        background: { r: 10, g: 20, b: 30, alpha: 0.5 },
      },
    }).png().toBuffer()

    await expect(readImageInfo(dataUrl('image/png', bytes))).resolves.toMatchObject({
      extension: 'png',
      width: 12,
      height: 8,
      orientation: null,
      hasAlpha: true,
      fileSizeBytes: bytes.length,
    })
  })

  it('保留原始像素尺寸与 EXIF 方向供调用方计算视觉宽高', async () => {
    const sharp = await loadSharp()
    const bytes = await sharp({
      create: {
        width: 12,
        height: 8,
        channels: 3,
        background: { r: 10, g: 20, b: 30 },
      },
    }).jpeg().withMetadata({ orientation: 6 }).toBuffer()

    await expect(readImageInfo(dataUrl('image/jpeg', bytes))).resolves.toMatchObject({
      extension: 'jpg',
      width: 12,
      height: 8,
      orientation: 6,
      hasAlpha: false,
    })
  })
})

describe('全景下载直写', () => {
  async function panoramaPng(): Promise<string> {
    const sharp = await loadSharp()
    const bytes = await sharp({
      create: {
        width: 16,
        height: 8,
        channels: 3,
        background: { r: 30, g: 60, b: 90 },
      },
    }).png().toBuffer()
    return dataUrl('image/png', bytes)
  }

  it('另存为只在用户目标生成带 GPano 元数据的最终文件', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-panorama-save-'))
    tempDirs.push(dir)
    const selectedPath = path.join(dir, 'selected-name')

    const savedPath = await savePanoramaImageSourceToPath(await panoramaPng(), selectedPath)

    expect(savedPath).toBe(`${selectedPath}.png`)
    expect(fs.readdirSync(dir)).toEqual(['selected-name.png'])
    await expect(readPanoramaImageMetadata(savedPath)).resolves.toMatchObject({ status: 'valid' })
  })

  it('批量下载直接写入目标目录且不创建中间副本', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-panorama-directory-'))
    tempDirs.push(dir)

    const savedPath = await savePanoramaImageSourceToDirectory(await panoramaPng(), dir, 'panorama-export')

    expect(savedPath).toBe(path.join(dir, 'panorama-export.png'))
    expect(fs.readdirSync(dir)).toEqual(['panorama-export.png'])
    await expect(readPanoramaImageMetadata(savedPath)).resolves.toMatchObject({ status: 'valid' })
  })
})
