import crypto from 'node:crypto'
import type { FileHandle } from 'node:fs/promises'
import fsp from 'node:fs/promises'
import path from 'node:path'

import { createMainLogger } from '../logging'
import type { SourceImageMetadata } from './contracts'
import { replaceFileAtomically } from './atomic-file'
import { readAssociatedNclxCicp } from './isobmff-cicp'
import { rewriteMetaWithAssociatedNclx, type FileBoxRange } from './isobmff-cicp-writer-layout'

type CicpMetadata = NonNullable<SourceImageMetadata['cicp']>

const logger = createMainLogger('main.image_editor_v3.isobmff_cicp_writer')
const MAX_META_BYTES = 16 * 1024 * 1024
const MAX_TOP_LEVEL_BOXES = 1_024
const COPY_CHUNK_BYTES = 1024 * 1024
const MAX_SAFE_FILE_SIZE = BigInt(Number.MAX_SAFE_INTEGER)
const SUPPORTED_BRANDS = new Set(['avif', 'heic', 'heix', 'hevc', 'hevx', 'mif1'])

function abortError(): Error {
  const error = new Error('CICP metadata write was cancelled')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError()
}

function invalid(message: string): never {
  throw new Error(`Unsupported HEIF layout: ${message}`)
}

function validateCicp(cicp: CicpMetadata): void {
  for (const value of [cicp.colorPrimaries, cicp.transferCharacteristics, cicp.matrixCoefficients]) {
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) invalid('CICP code point is out of range')
  }
  if (typeof cicp.fullRange !== 'boolean') invalid('CICP full-range flag is invalid')
}

async function readExactly(
  handle: FileHandle,
  offset: number,
  length: number,
  signal?: AbortSignal,
): Promise<Buffer> {
  const buffer = Buffer.allocUnsafe(length)
  let filled = 0
  while (filled < length) {
    throwIfAborted(signal)
    const { bytesRead } = await handle.read(buffer, filled, length - filled, offset + filled)
    if (bytesRead === 0) invalid('file was truncated while reading')
    filled += bytesRead
  }
  return buffer
}

async function scanTopLevel(handle: FileHandle, fileSize: number, signal?: AbortSignal): Promise<FileBoxRange[]> {
  const boxes: FileBoxRange[] = []
  let offset = 0
  while (offset < fileSize) {
    throwIfAborted(signal)
    if (boxes.length >= MAX_TOP_LEVEL_BOXES || offset > fileSize - 8) invalid('top-level box limit exceeded')
    const header = await readExactly(handle, offset, 8, signal)
    const declaredSize = header.readUInt32BE(0)
    const type = header.toString('latin1', 4, 8)
    let headerSize = 8
    let size: number
    if (declaredSize === 1) {
      if (offset > fileSize - 16) invalid('truncated top-level largesize box')
      const largeSize = (await readExactly(handle, offset + 8, 8, signal)).readBigUInt64BE(0)
      if (largeSize > MAX_SAFE_FILE_SIZE) invalid('top-level largesize exceeds safe integer range')
      size = Number(largeSize)
      headerSize = 16
    } else if (declaredSize === 0) {
      size = fileSize - offset
    } else {
      size = declaredSize
    }
    if (type === 'uuid') headerSize += 16
    if (size < headerSize || size > fileSize - offset) invalid('top-level box exceeds file bounds')
    boxes.push({ type, start: offset, payloadStart: offset + headerSize, end: offset + size })
    offset += size
  }
  return boxes
}

async function validateFileType(
  handle: FileHandle,
  ftyp: FileBoxRange,
  signal?: AbortSignal,
): Promise<'avif' | 'heif'> {
  const length = ftyp.end - ftyp.payloadStart
  if (length < 8 || length > 4096 || (length - 8) % 4 !== 0) invalid('invalid ftyp box')
  const payload = await readExactly(handle, ftyp.payloadStart, length, signal)
  const brands: string[] = []
  for (let offset = 0; offset < payload.byteLength; offset += 4) {
    if (offset !== 4) brands.push(payload.toString('latin1', offset, offset + 4))
  }
  if (!brands.some((brand) => SUPPORTED_BRANDS.has(brand))) invalid('unsupported file brand')
  return brands.includes('avif') ? 'avif' : 'heif'
}

async function copyRange(
  source: FileHandle,
  target: FileHandle,
  start: number,
  end: number,
  targetStart: number,
  signal?: AbortSignal,
): Promise<void> {
  const buffer = Buffer.allocUnsafe(Math.min(COPY_CHUNK_BYTES, end - start))
  let sourceOffset = start
  let targetOffset = targetStart
  while (sourceOffset < end) {
    throwIfAborted(signal)
    const length = Math.min(buffer.byteLength, end - sourceOffset)
    const { bytesRead } = await source.read(buffer, 0, length, sourceOffset)
    if (bytesRead !== length) invalid('file changed or was truncated during rewrite')
    let written = 0
    while (written < bytesRead) {
      const result = await target.write(buffer, written, bytesRead - written, targetOffset + written)
      if (result.bytesWritten === 0) throw new Error('Unable to write staged CICP file')
      written += result.bytesWritten
    }
    sourceOffset += bytesRead
    targetOffset += bytesRead
  }
}

async function writeExactly(handle: FileHandle, bytes: Buffer, position: number): Promise<void> {
  let written = 0
  while (written < bytes.byteLength) {
    const result = await handle.write(bytes, written, bytes.byteLength - written, position + written)
    if (result.bytesWritten === 0) throw new Error('Unable to write staged CICP metadata')
    written += result.bytesWritten
  }
}

function sameCicp(actual: SourceImageMetadata['cicp'], expected: CicpMetadata): boolean {
  return actual !== null
    && actual.colorPrimaries === expected.colorPrimaries
    && actual.transferCharacteristics === expected.transferCharacteristics
    && actual.matrixCoefficients === expected.matrixCoefficients
    && actual.fullRange === expected.fullRange
}

/**
 * Rewrites only a private/staged HEIF or AVIF file and publishes the verified result atomically.
 * It intentionally rejects sequences, external data references and layouts it cannot relocate.
 */
export async function writeAssociatedNclxCicpAtomically(
  stagedPath: string,
  cicp: CicpMetadata,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal)
  validateCicp(cicp)
  logger.info('开始写入 HEIF CICP 元数据', { event: 'image_editor_v3.cicp_write.start' })
  const temporaryPath = path.join(
    path.dirname(stagedPath),
    `.${path.basename(stagedPath)}.${crypto.randomUUID()}.cicp.tmp`,
  )
  let source: FileHandle | undefined
  let target: FileHandle | undefined
  try {
    const linkStats = await fsp.lstat(stagedPath, { bigint: true })
    if (!linkStats.isFile() || linkStats.isSymbolicLink() || linkStats.size < 8n || linkStats.size > MAX_SAFE_FILE_SIZE) {
      invalid('staged path is not a bounded regular file')
    }
    source = await fsp.open(stagedPath, 'r')
    const initialStats = await source.stat({ bigint: true })
    if (initialStats.dev !== linkStats.dev || initialStats.ino !== linkStats.ino || initialStats.size !== linkStats.size) {
      invalid('staged file changed before rewrite')
    }
    const fileSize = Number(initialStats.size)
    const topLevel = await scanTopLevel(source, fileSize, signal)
    const allowed = new Set(['ftyp', 'meta', 'mdat', 'free', 'skip'])
    if (topLevel.some((box) => !allowed.has(box.type))) invalid('unknown top-level box')
    const ftypBoxes = topLevel.filter((box) => box.type === 'ftyp')
    const metaBoxes = topLevel.filter((box) => box.type === 'meta')
    const mdats = topLevel.filter((box) => box.type === 'mdat')
    if (ftypBoxes.length !== 1 || metaBoxes.length !== 1 || mdats.length === 0) invalid('missing or ambiguous required boxes')
    const format = await validateFileType(source, ftypBoxes[0], signal)
    const meta = metaBoxes[0]
    const metaLength = meta.end - meta.start
    if (metaLength > MAX_META_BYTES) invalid('meta box exceeds the bounded rewrite limit')
    const rewrittenMeta = rewriteMetaWithAssociatedNclx(
      await readExactly(source, meta.start, metaLength, signal),
      meta,
      fileSize,
      mdats,
      cicp,
    )

    target = await fsp.open(temporaryPath, 'wx', 0o600)
    await copyRange(source, target, 0, meta.start, 0, signal)
    await writeExactly(target, rewrittenMeta, meta.start)
    await copyRange(source, target, meta.end, fileSize, meta.start + rewrittenMeta.byteLength, signal)
    const finalStats = await source.stat({ bigint: true })
    if (finalStats.size !== initialStats.size || finalStats.mtimeNs !== initialStats.mtimeNs) {
      invalid('staged file changed during rewrite')
    }
    await target.sync()
    await target.close()
    target = undefined
    throwIfAborted(signal)
    const verified = await readAssociatedNclxCicp(temporaryPath, format, signal)
    if (!sameCicp(verified, cicp)) throw new Error('Written HEIF CICP metadata failed verification')
    throwIfAborted(signal)
    await source.close()
    source = undefined
    await replaceFileAtomically(temporaryPath, stagedPath)
    logger.info('HEIF CICP 元数据写入完成', { event: 'image_editor_v3.cicp_write.completed' })
  } catch (error) {
    logger.error('HEIF CICP 元数据写入失败', { event: 'image_editor_v3.cicp_write.failed', error })
    throw error
  } finally {
    await target?.close().catch(() => undefined)
    await source?.close().catch(() => undefined)
    await fsp.rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}
