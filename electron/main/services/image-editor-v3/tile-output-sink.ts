import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'

import { createMainLogger } from '../logging'
import { replaceFileAtomically } from './atomic-file'
import type { OutputTile, TileOutputDescription, TileOutputSink } from './contracts'

const logger = createMainLogger('main.image_editor_v3.output')

type SinkState =
  | 'idle'
  | 'starting'
  | 'writing'
  | 'completing'
  | 'publishing'
  | 'completed'
  | 'cancelled'
  | 'failed'

export interface FileTileOutputSinkOptions {
  validateSnapshot?: (description: TileOutputDescription) => boolean | Promise<boolean>
}

function bytesPerChannel(bitDepth: TileOutputDescription['bitDepth']): number {
  return bitDepth === 8 ? 1 : bitDepth === 16 ? 2 : 4
}

/**
 * 文件输出事务的共同状态机。具体 PNG/TIFF/AVIF 编码器只实现三个 hook；临时文件、
 * 原子替换、失败/取消回滚和瓦片边界校验统一由基类保证。
 */
export abstract class FileTileOutputSinkBase implements TileOutputSink {
  private state: SinkState = 'idle'
  private description: TileOutputDescription | undefined
  private stagedPath: string | undefined
  private activeWrite: Promise<void> | undefined
  private activeLifecycle: Promise<void> | undefined
  private cancellation: Promise<void> | undefined
  private generation = 0
  private coverageMode: 'strip' | 'grid' | undefined
  private nextStripY = 0
  private nextGridIndex = 0
  private gridTileWidth = 0
  private gridTileHeight = 0

  protected constructor(
    readonly targetPath: string,
    private readonly options: FileTileOutputSinkOptions = {},
  ) {
    if (!targetPath.trim()) throw new Error('Tile output target path is empty')
  }

  async begin(description: TileOutputDescription): Promise<void> {
    if (this.state !== 'idle') throw new Error(`Cannot begin tile output while ${this.state}`)
    this.validateDescription(description)
    await fsp.mkdir(path.dirname(this.targetPath), { recursive: true })
    this.description = { ...description }
    this.stagedPath = path.join(
      path.dirname(this.targetPath),
      `.${path.basename(this.targetPath)}.${crypto.randomUUID()}.tmp`,
    )
    this.state = 'starting'
    const generation = ++this.generation
    logger.info('开始流式导出图片', {
      event: 'image_editor_v3.output.start',
      context: {
        documentId: description.documentId,
        revision: description.revision,
        width: description.width,
        height: description.height,
      },
    })
    const lifecycle = this.onBegin(this.stagedPath, this.description)
    this.activeLifecycle = lifecycle
    try {
      await lifecycle
      this.assertActive(generation, 'starting')
      this.state = 'writing'
    } catch (error) {
      if (!this.isCancelled()) await this.fail(error)
      throw error
    } finally {
      if (this.activeLifecycle === lifecycle) this.activeLifecycle = undefined
    }
  }

  async writeTile(tile: OutputTile): Promise<void> {
    if (this.state !== 'writing' || !this.description || !this.stagedPath) {
      throw new Error(`Cannot write output tile while ${this.state}`)
    }
    if (this.activeWrite) throw new Error('Concurrent tile writes are not allowed')
    this.validateTile(tile, this.description)
    this.recordCoverage(tile, this.description)
    const generation = this.generation
    const write = this.onWriteTile(this.stagedPath, tile, this.description)
    this.activeWrite = write
    try {
      await write
      this.assertActive(generation, 'writing')
    } catch (error) {
      if (!this.isCancelled()) await this.fail(error)
      throw error
    } finally {
      if (this.activeWrite === write) this.activeWrite = undefined
    }
  }

  async complete(): Promise<void> {
    if (this.state !== 'writing' || !this.description || !this.stagedPath) {
      throw new Error(`Cannot complete tile output while ${this.state}`)
    }
    if (this.activeWrite) throw new Error('Cannot complete while a tile write is in flight')
    this.state = 'completing'
    const generation = this.generation
    const stagedPath = this.stagedPath
    let lifecycle: Promise<void> | undefined
    try {
      // 覆盖校验也属于输出事务。缺块/乱序必须像编码失败一样关闭编码器并清理临时文件，
      // 不能要求调用方再补一次 cancel 才完成回滚。
      this.assertCompleteCoverage(this.description)
      lifecycle = this.onComplete(stagedPath, this.description)
      this.activeLifecycle = lifecycle
      await lifecycle
      this.assertActive(generation, 'completing')
      const stats = await fsp.stat(stagedPath)
      if (!stats.isFile() || stats.size === 0) throw new Error('Output encoder did not produce a file')
      await this.verifyStagedFile(stagedPath, this.description)
      this.assertActive(generation, 'completing')
      if (this.options.validateSnapshot && !(await this.options.validateSnapshot(this.description))) {
        throw new Error('Output snapshot is no longer current')
      }
      this.assertActive(generation, 'completing')
      // Windows 的 FlushFileBuffers 需要可写句柄；只读句柄调用 fsync 会返回 EPERM。
      // staged 文件由当前事务独占创建，因此用 r+ 不会扩大目标文件的写权限边界。
      const handle = await fsp.open(stagedPath, 'r+')
      try {
        await handle.sync()
      } finally {
        await handle.close()
      }
      this.assertActive(generation, 'completing')
      // 发布是一个不可取消的极短原子区间；进入前发生的 cancel 都已由代际检查拦截。
      this.state = 'publishing'
      await replaceFileAtomically(stagedPath, this.targetPath)
      this.state = 'completed'
      logger.info('流式导出图片完成', {
        event: 'image_editor_v3.output.completed',
        context: {
          documentId: this.description.documentId,
          revision: this.description.revision,
          byteLength: stats.size,
        },
      })
    } catch (error) {
      if (!this.isCancelled()) await this.fail(error)
      throw error
    } finally {
      if (lifecycle && this.activeLifecycle === lifecycle) this.activeLifecycle = undefined
    }
  }

  async cancel(reason?: unknown): Promise<void> {
    if (this.state === 'completed' || this.state === 'publishing') return
    if (this.cancellation) return this.cancellation
    const cancellation = this.performCancel(reason)
    this.cancellation = cancellation
    try {
      await cancellation
    } finally {
      if (this.cancellation === cancellation) this.cancellation = undefined
    }
  }

  protected abstract onBegin(
    stagedPath: string,
    description: TileOutputDescription,
  ): Promise<void>

  protected abstract onWriteTile(
    stagedPath: string,
    tile: OutputTile,
    description: TileOutputDescription,
  ): Promise<void>

  protected abstract onComplete(
    stagedPath: string,
    description: TileOutputDescription,
  ): Promise<void>

  protected async verifyStagedFile(
    _stagedPath: string,
    _description: TileOutputDescription,
  ): Promise<void> {}

  protected async onCancel(_reason?: unknown): Promise<void> {}

  private validateDescription(description: TileOutputDescription): void {
    if (!Number.isSafeInteger(description.width) || description.width < 1) throw new Error('Invalid output width')
    if (!Number.isSafeInteger(description.height) || description.height < 1) throw new Error('Invalid output height')
    if (!Number.isSafeInteger(description.revision) || description.revision < 0) {
      throw new Error('Invalid output document revision')
    }
    if (description.bitDepth === 32 && description.sampleFormat !== 'float') {
      throw new Error('32-bit output must use float samples')
    }
    if (description.bitDepth !== 32 && description.sampleFormat !== 'uint') {
      throw new Error('8/16-bit output must use unsigned integer samples')
    }
    const hdr = description.transferFunction === 'pq' || description.transferFunction === 'hlg'
    if (hdr && (description.colorSpace !== 'rec2020' || description.bitDepth < 16 || !description.cicp)) {
      throw new Error('HDR output requires Rec.2020, 16/32-bit samples and explicit CICP metadata')
    }
  }

  private validateTile(tile: OutputTile, description: TileOutputDescription): void {
    for (const [name, value] of Object.entries({
      x: tile.x,
      y: tile.y,
      width: tile.width,
      height: tile.height,
      rowStride: tile.rowStride,
    })) {
      if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid output tile ${name}`)
    }
    if (tile.width < 1 || tile.height < 1) throw new Error('Output tile dimensions must be positive')
    if (tile.x + tile.width > description.width || tile.y + tile.height > description.height) {
      throw new Error('Output tile exceeds document bounds')
    }
    const packedRowBytes = tile.width * description.channels * bytesPerChannel(description.bitDepth)
    if (tile.rowStride < packedRowBytes || tile.pixels.byteLength < tile.rowStride * tile.height) {
      throw new Error('Output tile buffer is smaller than its declared layout')
    }
  }

  private recordCoverage(tile: OutputTile, description: TileOutputDescription): void {
    if (!this.coverageMode) {
      if (tile.x === 0 && tile.width === description.width) {
        this.coverageMode = 'strip'
      } else {
        if (tile.x !== 0 || tile.y !== 0) throw new Error('Grid output must begin at the top-left tile')
        this.coverageMode = 'grid'
        this.gridTileWidth = tile.width
        this.gridTileHeight = tile.height
      }
    }
    if (this.coverageMode === 'strip') {
      if (tile.x !== 0 || tile.width !== description.width || tile.y !== this.nextStripY) {
        throw new Error('Output strips must cover the full width in scanline order without gaps')
      }
      this.nextStripY += tile.height
      return
    }
    const columns = Math.ceil(description.width / this.gridTileWidth)
    const column = this.nextGridIndex % columns
    const row = Math.floor(this.nextGridIndex / columns)
    const expectedX = column * this.gridTileWidth
    const expectedY = row * this.gridTileHeight
    const expectedWidth = Math.min(this.gridTileWidth, description.width - expectedX)
    const expectedHeight = Math.min(this.gridTileHeight, description.height - expectedY)
    if (
      tile.x !== expectedX
      || tile.y !== expectedY
      || tile.width !== expectedWidth
      || tile.height !== expectedHeight
    ) {
      throw new Error('Output tiles must form a complete fixed grid in scanline order')
    }
    this.nextGridIndex += 1
  }

  private assertCompleteCoverage(description: TileOutputDescription): void {
    if (!this.coverageMode) throw new Error('Output contains no pixel data')
    if (this.coverageMode === 'strip') {
      if (this.nextStripY !== description.height) throw new Error('Output strips do not cover the full image')
      return
    }
    const expected = Math.ceil(description.width / this.gridTileWidth)
      * Math.ceil(description.height / this.gridTileHeight)
    if (this.nextGridIndex !== expected) throw new Error('Output tile grid is incomplete')
  }

  private assertActive(generation: number, expectedState: SinkState): void {
    if (generation !== this.generation || this.state !== expectedState) throw this.createAbortError()
  }

  private async performCancel(reason?: unknown): Promise<void> {
    if (this.state === 'cancelled') return
    const stagedPath = this.stagedPath
    this.state = 'cancelled'
    this.generation += 1
    // 第一遍让编码器立即看到取消；第二遍覆盖 onBegin 晚创建底层资源的竞态。
    await this.onCancel(reason).catch(() => undefined)
    await Promise.all([
      this.activeWrite?.catch(() => undefined),
      this.activeLifecycle?.catch(() => undefined),
    ])
    await this.onCancel(reason).catch(() => undefined)
    if (stagedPath) await fsp.rm(stagedPath, { force: true }).catch(() => undefined)
    logger.info('流式导出图片已取消', {
      event: 'image_editor_v3.output.cancelled',
      context: this.description
        ? { documentId: this.description.documentId, revision: this.description.revision }
        : undefined,
    })
  }

  private createAbortError(): Error {
    const error = new Error('Tile output was cancelled')
    error.name = 'AbortError'
    return error
  }

  private async fail(error: unknown): Promise<void> {
    const stagedPath = this.stagedPath
    this.state = 'failed'
    await this.onCancel(error).catch(() => undefined)
    if (stagedPath) await fsp.rm(stagedPath, { force: true }).catch(() => undefined)
    logger.error('流式导出图片失败', {
      event: 'image_editor_v3.output.failed',
      context: this.description
        ? { documentId: this.description.documentId, revision: this.description.revision }
        : undefined,
      error,
    })
  }

  private isCancelled(): boolean {
    return this.state === 'cancelled'
  }
}
