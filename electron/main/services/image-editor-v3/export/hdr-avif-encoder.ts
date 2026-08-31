import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import type { Writable } from 'node:stream'

import { loadFfmpegPath } from '../../video/ffmpeg-loader'
import type { OutputTile, TileOutputDescription } from '../contracts'
import type { TranscodingExportOptions } from './transcoding-output-sink'

type HdrAvifFormat = 'avif10' | 'avif12'
type EncoderProcess = ChildProcessByStdio<Writable, null, Readable>

const BYTES_PER_PIXEL = 8
const MAX_TILE_BAND_BYTES = 96 * 1024 * 1024
const MAX_STDERR_BYTES = 64 * 1024
const CANCEL_GRACE_MS = 2_000
const STARTUP_HEALTHCHECK_MS = 100

function createAbortError(): Error {
  const error = new Error('HDR AVIF encoding was cancelled')
  error.name = 'AbortError'
  return error
}

function isHdrAvifFormat(format: TranscodingExportOptions['format']): format is HdrAvifFormat {
  return format === 'avif10' || format === 'avif12'
}

export function requiresStreamingHdrAvifEncoder(
  description: TileOutputDescription,
  format: TranscodingExportOptions['format'],
): format is HdrAvifFormat {
  return isHdrAvifFormat(format)
    && (description.transferFunction === 'pq' || description.transferFunction === 'hlg')
}

function boundedStderr(previous: string, chunk: Buffer): string {
  return (previous + chunk.toString('utf8')).slice(-MAX_STDERR_BYTES)
}

function encoderArguments(
  stagedPath: string,
  description: TileOutputDescription,
  options: TranscodingExportOptions & { format: HdrAvifFormat },
): string[] {
  const bits = options.format === 'avif10' ? 10 : 12
  const transfer = description.transferFunction === 'pq' ? 'smpte2084' : 'arib-std-b67'
  const quality = options.quality ?? 90
  const crf = Math.round((100 - quality) * 0.63)
  const cpuUsed = Math.max(0, Math.min(8, 9 - (options.effort ?? 4)))
  const colorPixelFormat = `yuv444p${bits}le`
  const alphaPixelFormat = `gray${bits}le`
  const filter = [
    '[0:v]split=2[color][alpha];',
    `[color]zscale=matrixin=gbr:primariesin=2020:transferin=${transfer}:rangein=full:`,
    `matrix=2020_ncl:primaries=2020:transfer=${transfer}:range=limited,`,
    `format=${colorPixelFormat}[colorout];`,
    `[alpha]alphaextract,format=${alphaPixelFormat}[alphaout]`,
  ].join('')

  return [
    '-y',
    '-hide_banner',
    '-loglevel', 'warning',
    '-f', 'rawvideo',
    '-pixel_format', 'rgba64le',
    '-video_size', `${description.width}x${description.height}`,
    '-framerate', '1',
    '-i', 'pipe:0',
    '-filter_complex', filter,
    '-map', '[colorout]',
    '-map', '[alphaout]',
    '-frames:v:0', '1',
    '-frames:v:1', '1',
    '-c:v', 'libaom-av1',
    '-still-picture', '1',
    '-cpu-used:v:0', String(cpuUsed),
    '-cpu-used:v:1', String(cpuUsed),
    '-crf:v:0', String(crf),
    '-crf:v:1', '0',
    '-aom-params:v:1', 'lossless=1',
    '-color_primaries:v:0', 'bt2020',
    '-color_trc:v:0', transfer,
    '-colorspace:v:0', 'bt2020nc',
    '-color_range:v:0', 'tv',
    '-color_primaries:v:1', 'bt709',
    '-color_trc:v:1', 'linear',
    '-colorspace:v:1', 'bt709',
    '-color_range:v:1', 'pc',
    '-f', 'avif',
    stagedPath,
  ]
}

function writeBytes(stream: Writable, bytes: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(bytes, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

function endStream(stream: Writable): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.end((error?: Error | null) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

/**
 * Feeds scanline-ordered 16-bit RGBA into FFmpeg without a full-frame JS surface.
 * FFmpeg/zscale owns RGB-full -> BT.2020-NCL-limited conversion before libaom sees the
 * frame, so the AV1 sequence header and AVIF nclx describe the matrix that was encoded.
 */
export class StreamingHdrAvifEncoder {
  private child: EncoderProcess | undefined
  private completion: Promise<void> | undefined
  private stderr = ''
  private cancelled = false
  private tileBand: Buffer | undefined
  private tileBandY = 0
  private tileBandHeight = 0

  constructor(
    private readonly stagedPath: string,
    private readonly description: TileOutputDescription,
    private readonly options: TranscodingExportOptions & { format: HdrAvifFormat },
    private readonly loadEncoderPath: () => Promise<string> = loadFfmpegPath,
  ) {}

  async begin(): Promise<void> {
    const ffmpegPath = await this.loadEncoderPath()
    if (this.cancelled) throw createAbortError()
    const child = spawn(
      ffmpegPath,
      encoderArguments(this.stagedPath, this.description, this.options),
      { stdio: ['pipe', 'ignore', 'pipe'] },
    )
    this.child = child
    child.stderr.on('data', (chunk: Buffer) => {
      this.stderr = boundedStderr(this.stderr, chunk)
    })
    this.completion = new Promise<void>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (code, signal) => {
        if (this.cancelled) {
          reject(createAbortError())
        } else if (code === 0) {
          resolve()
        } else {
          reject(new Error(
            `HDR AVIF encoder failed with code ${String(code)} signal ${String(signal)}\n${this.stderr}`,
          ))
        }
      })
    })
    void this.completion.catch(() => undefined)
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve)
      child.once('error', reject)
    })
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      this.completion.then(() => {
        throw new Error('HDR AVIF encoder exited before accepting pixel input')
      }),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, STARTUP_HEALTHCHECK_MS)
        timer.unref()
      }),
    ])
    if (timer) clearTimeout(timer)
    if (this.cancelled) throw createAbortError()
  }

  async writeTile(tile: OutputTile): Promise<void> {
    const child = this.child
    const completion = this.completion
    if (!child || !completion) throw new Error('HDR AVIF encoder has not started')
    if (this.cancelled) throw createAbortError()
    if (child.exitCode !== null || child.signalCode !== null || child.stdin.destroyed) {
      await completion
      throw new Error('HDR AVIF encoder closed before receiving all pixels')
    }

    if (tile.x === 0 && tile.width === this.description.width) {
      if (this.tileBand) throw new Error('Cannot switch HDR AVIF input from grid tiles to strips')
      await this.writePackedRows(tile, child.stdin)
      return
    }

    if (tile.x === 0) this.beginTileBand(tile)
    const band = this.tileBand
    if (!band || tile.y !== this.tileBandY || tile.height !== this.tileBandHeight) {
      throw new Error('HDR AVIF grid tiles changed height within a scanline band')
    }
    this.copyTileIntoBand(tile, band)
    if (tile.x + tile.width === this.description.width) {
      this.tileBand = undefined
      await writeBytes(child.stdin, band)
      if (this.cancelled) throw createAbortError()
    }
  }

  async complete(): Promise<void> {
    const child = this.child
    const completion = this.completion
    if (!child || !completion) throw new Error('HDR AVIF encoder has not started')
    if (this.tileBand) throw new Error('HDR AVIF input ended with an incomplete tile band')
    await endStream(child.stdin)
    await completion
  }

  async cancel(): Promise<void> {
    if (this.cancelled) return
    this.cancelled = true
    this.tileBand = undefined
    const child = this.child
    const completion = this.completion
    if (!child || !completion) return
    child.stdin.destroy()
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      completion.catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, CANCEL_GRACE_MS)
        timer.unref()
      }),
    ])
    if (timer) clearTimeout(timer)
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
      await completion.catch(() => undefined)
    }
  }

  private beginTileBand(tile: OutputTile): void {
    if (this.tileBand) throw new Error('HDR AVIF tile band was not completed before the next band')
    const byteLength = this.description.width * tile.height * BYTES_PER_PIXEL
    if (!Number.isSafeInteger(byteLength) || byteLength > MAX_TILE_BAND_BYTES) {
      throw new Error(`HDR AVIF tile band exceeds the ${MAX_TILE_BAND_BYTES}-byte memory limit`)
    }
    this.tileBand = Buffer.allocUnsafe(byteLength)
    this.tileBandY = tile.y
    this.tileBandHeight = tile.height
  }

  private copyTileIntoBand(tile: OutputTile, band: Buffer): void {
    const source = Buffer.from(tile.pixels.buffer, tile.pixels.byteOffset, tile.pixels.byteLength)
    const rowBytes = tile.width * BYTES_PER_PIXEL
    for (let row = 0; row < tile.height; row += 1) {
      source.copy(
        band,
        (row * this.description.width + tile.x) * BYTES_PER_PIXEL,
        row * tile.rowStride,
        row * tile.rowStride + rowBytes,
      )
    }
  }

  private async writePackedRows(tile: OutputTile, stream: Writable): Promise<void> {
    const source = Buffer.from(tile.pixels.buffer, tile.pixels.byteOffset, tile.pixels.byteLength)
    const rowBytes = tile.width * BYTES_PER_PIXEL
    if (tile.rowStride === rowBytes) {
      await writeBytes(stream, source.subarray(0, rowBytes * tile.height))
      return
    }
    for (let row = 0; row < tile.height; row += 1) {
      await writeBytes(stream, source.subarray(row * tile.rowStride, row * tile.rowStride + rowBytes))
      if (this.cancelled) throw createAbortError()
    }
  }
}
