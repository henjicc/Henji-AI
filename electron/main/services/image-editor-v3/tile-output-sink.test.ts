import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { OutputTile, TileOutputDescription } from './contracts'
import { FileTileOutputSinkBase } from './tile-output-sink'

class TestTileSink extends FileTileOutputSinkBase {
  capturedStagedPath = ''
  failComplete = false

  completeGate: Promise<void> | undefined

  constructor(targetPath: string, validateSnapshot?: () => boolean | Promise<boolean>) {
    super(targetPath, { validateSnapshot })
  }

  protected async onBegin(stagedPath: string): Promise<void> {
    this.capturedStagedPath = stagedPath
    await fsp.writeFile(stagedPath, Buffer.from('header'))
  }

  protected async onWriteTile(stagedPath: string, tile: OutputTile): Promise<void> {
    await fsp.appendFile(stagedPath, tile.pixels)
  }

  protected async onComplete(stagedPath: string, _description: TileOutputDescription): Promise<void> {
    await this.completeGate
    if (this.failComplete) throw new Error('encoder failed')
    await fsp.appendFile(stagedPath, Buffer.from('done'))
  }
}

const description: TileOutputDescription = {
  width: 2,
  height: 1,
  channels: 4,
  bitDepth: 8,
  sampleFormat: 'uint',
  colorSpace: 'srgb',
  transferFunction: 'srgb',
  alphaMode: 'straight',
  documentId: 'document',
  revision: 3,
}

let rootDir = ''

beforeEach(async () => {
  rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'henji-image-v3-output-'))
})

afterEach(async () => {
  await fsp.rm(rootDir, { recursive: true, force: true })
})

describe('FileTileOutputSinkBase', () => {
  it('后端重试先清理旧staging，再由新session单独原子替换目标', async () => {
    const targetPath = path.join(rootDir, 'backend-retry.bin')
    await fsp.writeFile(targetPath, 'old-target')
    const gpu = new TestTileSink(targetPath)
    await gpu.begin(description)
    await gpu.writeTile({
      x: 0, y: 0, width: 1, height: 1, rowStride: 4,
      pixels: Uint8Array.from([9, 9, 9, 9]),
    })
    await gpu.cancel('render_backend_retry')
    expect(await fsp.readFile(targetPath, 'utf8')).toBe('old-target')
    await expect(fsp.access(gpu.capturedStagedPath)).rejects.toThrow()

    const cpu = new TestTileSink(targetPath)
    await cpu.begin(description)
    await cpu.writeTile({
      x: 0, y: 0, width: 2, height: 1, rowStride: 8,
      pixels: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]),
    })
    await cpu.complete()

    expect(await fsp.readFile(targetPath)).toEqual(Buffer.concat([
      Buffer.from('header'),
      Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]),
      Buffer.from('done'),
    ]))
    await expect(fsp.access(cpu.capturedStagedPath)).rejects.toThrow()
  })

  it('只在编码完成后原子替换目标', async () => {
    const targetPath = path.join(rootDir, 'output.bin')
    await fsp.writeFile(targetPath, 'old')
    const sink = new TestTileSink(targetPath)
    await sink.begin(description)
    expect(await fsp.readFile(targetPath, 'utf8')).toBe('old')
    await sink.writeTile({
      x: 0,
      y: 0,
      width: 2,
      height: 1,
      rowStride: 8,
      pixels: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]),
    })
    await sink.complete()

    expect(await fsp.readFile(targetPath)).toEqual(Buffer.concat([
      Buffer.from('header'),
      Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]),
      Buffer.from('done'),
    ]))
    await expect(fsp.access(sink.capturedStagedPath)).rejects.toThrow()
  })

  it('取消或编码失败都会清理临时文件并保留旧目标', async () => {
    const targetPath = path.join(rootDir, 'output.bin')
    await fsp.writeFile(targetPath, 'old')
    const cancelled = new TestTileSink(targetPath)
    await cancelled.begin(description)
    await cancelled.cancel()
    await expect(fsp.access(cancelled.capturedStagedPath)).rejects.toThrow()
    expect(await fsp.readFile(targetPath, 'utf8')).toBe('old')

    const failed = new TestTileSink(targetPath)
    failed.failComplete = true
    await failed.begin(description)
    await failed.writeTile({
      x: 0,
      y: 0,
      width: 2,
      height: 1,
      rowStride: 8,
      pixels: new Uint8Array(8),
    })
    await expect(failed.complete()).rejects.toThrow('encoder failed')
    await expect(fsp.access(failed.capturedStagedPath)).rejects.toThrow()
    expect(await fsp.readFile(targetPath, 'utf8')).toBe('old')
  })

  it('拒绝缺块、乱序和过期快照并自动回滚', async () => {
    const targetPath = path.join(rootDir, 'coverage.bin')
    const incomplete = new TestTileSink(targetPath)
    await incomplete.begin({ ...description, width: 4, height: 2 })
    await incomplete.writeTile({
      x: 0, y: 0, width: 2, height: 1, rowStride: 8, pixels: new Uint8Array(8),
    })
    await expect(incomplete.complete()).rejects.toThrow('incomplete')
    await expect(fsp.access(incomplete.capturedStagedPath)).rejects.toThrow()

    const stale = new TestTileSink(targetPath, () => false)
    await stale.begin(description)
    await stale.writeTile({
      x: 0, y: 0, width: 2, height: 1, rowStride: 8, pixels: new Uint8Array(8),
    })
    await expect(stale.complete()).rejects.toThrow('no longer current')
    await expect(fsp.access(targetPath)).rejects.toThrow()
  })

  it('complete 编码期间取消后绝不发布临时结果', async () => {
    const targetPath = path.join(rootDir, 'cancel-race.bin')
    await fsp.writeFile(targetPath, 'old')
    let releaseComplete: (() => void) | undefined
    const sink = new TestTileSink(targetPath)
    sink.completeGate = new Promise<void>((resolve) => { releaseComplete = resolve })
    await sink.begin(description)
    await sink.writeTile({
      x: 0, y: 0, width: 2, height: 1, rowStride: 8, pixels: new Uint8Array(8),
    })
    const completing = sink.complete()
    const cancelling = sink.cancel()
    releaseComplete?.()
    await expect(completing).rejects.toMatchObject({ name: 'AbortError' })
    await cancelling
    expect(await fsp.readFile(targetPath, 'utf8')).toBe('old')
    await expect(fsp.access(sink.capturedStagedPath)).rejects.toThrow()
  })
})
