import path from 'node:path'

import {
  IMAGE_EDIT_BRUSH_TILE_MAX_RAW_BYTES_V3,
  IMAGE_EDIT_BRUSH_TILE_MAX_RESOURCE_BYTES_V3,
  IMAGE_EDITOR_V3_MAX_DATA_URL_CHARACTERS,
  parseDocumentRef,
  type ImageEditorV3SourceLocator,
  type ResourceId,
} from '../services/image-editor-v3'
import {
  createFloat32PremultipliedRgbaTile,
} from '../../../src/core/imageEdit/v3/effects/contracts'
import type { ImageEditBrushTileV3 } from '../../../src/core/imageEdit/v3/brush/contracts'
import {
  decodeImageEditCommandHistorySnapshotV3,
  type ImageEditCommandHistorySnapshotV3,
} from '../../../src/core/imageEdit/v3/commandHistoryCodec'
import { collectImageEditJsonResourceIdsV3 } from '../../../src/core/imageEdit/v3/resourceReferences'
import { decodeImageEditDocumentV3 } from '../../../src/core/imageEdit/v3/documentCodec'
import { parseRecord } from './registry'

const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const REQUEST_ID_PATTERN = /^[A-Za-z0-9:_-]{1,160}$/
const RESOURCE_REF_PATTERN = /^sha256:[a-f0-9]{64}$/
const MAX_DOCUMENT_BYTES = 64 * 1024 * 1024
const MAX_RESOURCE_REFS = 50_000
const MAX_PROXY_DIMENSION = 4_096
const MAX_IPC_TILE_HALO = 512
const MAX_PYRAMID_PREWARM_TILES = 4_096
const MAX_LOCAL_PATH_CHARACTERS = 32_768
const MAX_HTTP_URL_CHARACTERS = 8_192
const MAX_BRUSH_TILES_PER_REQUEST = 16
const MAX_BRUSH_REQUEST_RAW_BYTES = 64 * 1024 * 1024
const MAX_BRUSH_REQUEST_RESOURCE_BYTES = 64 * 1024 * 1024
const BRUSH_TILE_KEY_PATTERN = /^(0|[1-9]\d*)\/(0|[1-9]\d*)\/(0|[1-9]\d*)$/

export interface BasePayload { requestId: string }
export interface LoadDocumentPayload extends BasePayload { documentRef: string }
export interface SaveDocumentPayload extends BasePayload {
  documentId: string
  revision: number
  document: unknown
  history?: ImageEditCommandHistorySnapshotV3
  expectedRevision: number
  resourceRefs: ResourceId[]
  previewRef?: ResourceId
}
export interface ResourcePayload extends BasePayload { resourceRef: ResourceId }
export interface FastProxyPayload extends ResourcePayload { maxDimension: number }
export interface PyramidPrewarmPayload extends ResourcePayload {
  minimumMip?: number
  maximumMip?: number
  tileBudget?: number
  bitDepth?: 8 | 16 | 32
}
export interface TilePayload extends ResourcePayload {
  mip: number
  tileX: number
  tileY: number
  halo: number
  bitDepth?: 8 | 16 | 32
}
export interface SavePackagePayload extends LoadDocumentPayload { revision: number; suggestedName?: string }
export interface GarbageCollectPayload extends BasePayload { retainedResourceRefs: ResourceId[] }
export interface IngestSourcePayload extends BasePayload { source: ImageEditorV3SourceLocator }
export interface PersistBrushTilesPayload extends BasePayload {
  tiles: Array<{ tileKey: string; tile: ImageEditBrushTileV3 }>
  rawByteLength: number
}
export interface ReadBrushTilesPayload extends BasePayload {
  tiles: Array<{
    tileKey: string
    resource: { resourceId: ResourceId; byteSize: number }
  }>
  resourceByteLength: number
  maximumDecodedByteLength: number
}

function readRequestId(record: Record<string, unknown>): string {
  const value = record.requestId
  if (typeof value !== 'string' || !REQUEST_ID_PATTERN.test(value)) throw new Error('Invalid requestId')
  return value
}

function readSafeInteger(record: Record<string, unknown>, field: string, minimum: number, maximum: number): number {
  const value = record[field]
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`Invalid ${field}`)
  }
  return value as number
}

function readResourceRef(value: unknown, field: string): ResourceId {
  if (typeof value !== 'string' || !RESOURCE_REF_PATTERN.test(value)) throw new Error(`Invalid ${field}`)
  return value as ResourceId
}

function readResourceRefs(value: unknown, field: string): ResourceId[] {
  if (!Array.isArray(value) || value.length > MAX_RESOURCE_REFS) throw new Error(`Invalid ${field}`)
  return [...new Set(value.map((item) => readResourceRef(item, field)))].sort()
}

function assertExactKeys(record: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const allowedKeys = new Set(allowed)
  const unknown = Object.keys(record).find((key) => !allowedKeys.has(key))
  if (unknown) throw new Error(`Invalid ${label}: unknown field ${unknown}`)
}

function readBrushTileKey(value: unknown): string {
  if (typeof value !== 'string' || value.length > 96 || !BRUSH_TILE_KEY_PATTERN.test(value)) {
    throw new Error('Invalid brush tileKey')
  }
  const [mip, tileX, tileY] = value.split('/').map(Number)
  if (!Number.isSafeInteger(mip) || mip > 30
    || !Number.isSafeInteger(tileX) || !Number.isSafeInteger(tileY)) {
    throw new Error('Invalid brush tileKey')
  }
  return value
}

function readBrushFloatData(value: unknown, expectedLength: number): Float32Array {
  const expectedBytes = expectedLength * Float32Array.BYTES_PER_ELEMENT
  if (value instanceof ArrayBuffer) {
    if (value.byteLength !== expectedBytes) throw new Error('Brush tile ArrayBuffer length mismatch')
    return new Float32Array(value)
  }
  if (value instanceof Float32Array) {
    if (!(value.buffer instanceof ArrayBuffer)
      || value.byteOffset !== 0
      || value.byteLength !== expectedBytes
      || value.buffer.byteLength !== expectedBytes) {
      throw new Error('Brush tile Float32Array must use an exact, unshared backing buffer')
    }
    return value
  }
  throw new Error('Brush tile data must be an ArrayBuffer or Float32Array')
}

function readBrushDimension(record: Record<string, unknown>, field: 'width' | 'height'): number {
  return readSafeInteger(record, field, 1, 512)
}

function readEnum<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new Error(`Invalid brush tile ${label}`)
  return value as T
}

function readBrushTile(value: unknown): ImageEditBrushTileV3 {
  const tile = parseRecord(value)
  const width = readBrushDimension(tile, 'width')
  const height = readBrushDimension(tile, 'height')
  if (tile.storage === 'mask-float32') {
    assertExactKeys(tile, ['storage', 'width', 'height', 'data'], 'mask brush tile')
    return {
      storage: 'mask-float32',
      width,
      height,
      data: readBrushFloatData(tile.data, width * height),
    }
  }
  if (tile.storage !== 'rgba-float32') throw new Error('Invalid brush tile storage')
  assertExactKeys(tile, [
    'storage', 'width', 'height', 'data', 'colorDomain', 'workingSpace',
    'transferFunction', 'referenceWhiteNits', 'alpha',
  ], 'RGBA brush tile')
  if (tile.alpha !== 'premultiplied') throw new Error('RGBA brush tile must use premultiplied alpha')
  const referenceWhiteNits = tile.referenceWhiteNits
  if (typeof referenceWhiteNits !== 'number'
    || !Number.isFinite(referenceWhiteNits)
    || referenceWhiteNits <= 0) {
    throw new Error('Invalid brush tile referenceWhiteNits')
  }
  const data = readBrushFloatData(tile.data, width * height * 4)
  return createFloat32PremultipliedRgbaTile(
    width,
    height,
    readEnum<'source-encoded' | 'linear-light' | 'perceptual-working'>(
      tile.colorDomain,
      ['source-encoded', 'linear-light', 'perceptual-working'],
      'colorDomain',
    ),
    data,
    readEnum<'srgb' | 'display-p3' | 'rec2020'>(
      tile.workingSpace,
      ['srgb', 'display-p3', 'rec2020'],
      'workingSpace',
    ),
    readEnum<'srgb' | 'linear' | 'pq' | 'hlg'>(
      tile.transferFunction,
      ['srgb', 'linear', 'pq', 'hlg'],
      'transferFunction',
    ),
    referenceWhiteNits,
  )
}

function readBrushTileArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_BRUSH_TILES_PER_REQUEST) {
    throw new Error(`Invalid ${label} batch size`)
  }
  return value
}

function assertUniqueBrushTileKeys(keys: readonly string[]): void {
  if (new Set(keys).size !== keys.length) throw new Error('Brush tile batch contains duplicate tileKey')
}

export function normalizeImageEditorV3Document(
  value: unknown,
): { documentId: string; revision: number; document: unknown } {
  const serialized = JSON.stringify(value)
  if (serialized === undefined || Buffer.byteLength(serialized, 'utf8') > MAX_DOCUMENT_BYTES) {
    throw new Error('Image editor V3 document exceeds IPC limit')
  }
  const decoded = decodeImageEditDocumentV3(JSON.parse(serialized) as unknown)
  const document = decoded.document
  if (!document || !DOCUMENT_ID_PATTERN.test(document.id)) {
    throw new Error('Invalid image editor V3 document identity')
  }
  return {
    documentId: document.id,
    revision: document.revision,
    document,
  }
}

export function parseImageEditorV3BasePayload(input: unknown): BasePayload {
  return { requestId: readRequestId(parseRecord(input)) }
}

export function parseImageEditorV3LoadPayload(input: unknown): LoadDocumentPayload {
  const record = parseRecord(input)
  const documentRef = record.documentRef
  if (typeof documentRef !== 'string') throw new Error('Invalid documentRef')
  parseDocumentRef(documentRef)
  return { requestId: readRequestId(record), documentRef }
}

export function parseImageEditorV3SavePayload(input: unknown): SaveDocumentPayload {
  const record = parseRecord(input)
  const normalized = normalizeImageEditorV3Document(record.document)
  const expectedRevision = readSafeInteger(record, 'expectedRevision', 0, Number.MAX_SAFE_INTEGER)
  if (normalized.revision < expectedRevision) throw new Error('Document revision predates expectedRevision')
  const previewRef = record.previewRef === undefined || record.previewRef === null
    ? undefined
    : readResourceRef(record.previewRef, 'previewRef')
  if (record.history !== undefined && record.history !== null
    && (typeof record.history !== 'object' || Array.isArray(record.history))) {
    throw new Error('History must be a structured snapshot')
  }
  const history = record.history === undefined || record.history === null
    ? undefined
    : decodeImageEditCommandHistorySnapshotV3(record.history).snapshot
  if (history && (history.documentId !== normalized.documentId
    || history.headRevision !== normalized.revision)) {
    throw new Error('History snapshot head does not match document')
  }
  const historyRefs = history
    ? [...history.undo, ...history.redo]
      .flatMap((entry) => entry.resources.map((resource) => resource.resourceId))
    : []
  const resourceRefs = readResourceRefs(record.resourceRefs, 'resourceRefs')
  const requiredRefs = collectImageEditJsonResourceIdsV3(normalized.document, [
    ...(previewRef ? [previewRef] : []),
    ...historyRefs,
  ])
  if (requiredRefs.some((resourceRef) => !resourceRefs.includes(resourceRef as ResourceId))) {
    throw new Error('resourceRefs omit document, preview, or history resources')
  }
  return {
    requestId: readRequestId(record),
    ...normalized,
    expectedRevision,
    history,
    resourceRefs,
    previewRef,
  }
}

export function parseImageEditorV3ResourcePayload(input: unknown): ResourcePayload {
  const record = parseRecord(input)
  return { requestId: readRequestId(record), resourceRef: readResourceRef(record.resourceRef, 'resourceRef') }
}

export function parseImageEditorV3FastProxyPayload(input: unknown): FastProxyPayload {
  const record = parseRecord(input)
  return {
    ...parseImageEditorV3ResourcePayload(input),
    maxDimension: readSafeInteger(record, 'maxDimension', 32, MAX_PROXY_DIMENSION),
  }
}

export function parseImageEditorV3PyramidPrewarmPayload(input: unknown): PyramidPrewarmPayload {
  const record = parseRecord(input)
  assertExactKeys(record, [
    'requestId', 'resourceRef', 'minimumMip', 'maximumMip', 'tileBudget', 'bitDepth',
  ], 'source pyramid prewarm payload')
  const minimumMip = record.minimumMip === undefined
    ? undefined
    : readSafeInteger(record, 'minimumMip', 0, 30)
  const maximumMip = record.maximumMip === undefined
    ? undefined
    : readSafeInteger(record, 'maximumMip', 0, 30)
  if (minimumMip !== undefined && maximumMip !== undefined && maximumMip < minimumMip) {
    throw new Error('Invalid source pyramid prewarm mip range')
  }
  const bitDepth = record.bitDepth === undefined
    ? undefined
    : record.bitDepth === 8 || record.bitDepth === 16 || record.bitDepth === 32
      ? record.bitDepth
      : null
  if (bitDepth === null) throw new Error('Invalid source pyramid prewarm bitDepth')
  return {
    ...parseImageEditorV3ResourcePayload(input),
    minimumMip,
    maximumMip,
    tileBudget: record.tileBudget === undefined
      ? undefined
      : readSafeInteger(record, 'tileBudget', 1, MAX_PYRAMID_PREWARM_TILES),
    bitDepth,
  }
}

export function parseImageEditorV3TilePayload(input: unknown): TilePayload {
  const record = parseRecord(input)
  const rawBitDepth = record.bitDepth
  const bitDepth = rawBitDepth === undefined
    ? undefined
    : rawBitDepth === 8 || rawBitDepth === 16 || rawBitDepth === 32 ? rawBitDepth : null
  if (bitDepth === null) throw new Error('Invalid bitDepth')
  return {
    ...parseImageEditorV3ResourcePayload(input),
    mip: readSafeInteger(record, 'mip', 0, 30),
    tileX: readSafeInteger(record, 'tileX', 0, Number.MAX_SAFE_INTEGER),
    tileY: readSafeInteger(record, 'tileY', 0, Number.MAX_SAFE_INTEGER),
    halo: record.halo === undefined ? 0 : readSafeInteger(record, 'halo', 0, MAX_IPC_TILE_HALO),
    bitDepth,
  }
}

export function parseImageEditorV3SavePackagePayload(input: unknown): SavePackagePayload {
  const record = parseRecord(input)
  const suggestedName = record.suggestedName
  if (suggestedName !== undefined && (typeof suggestedName !== 'string' || suggestedName.length > 160)) {
    throw new Error('Invalid suggestedName')
  }
  return {
    ...parseImageEditorV3LoadPayload(input),
    revision: readSafeInteger(record, 'revision', 0, Number.MAX_SAFE_INTEGER),
    suggestedName,
  }
}

export function parseImageEditorV3GarbageCollectPayload(input: unknown): GarbageCollectPayload {
  const record = parseRecord(input)
  return {
    requestId: readRequestId(record),
    retainedResourceRefs: readResourceRefs(record.retainedResourceRefs, 'retainedResourceRefs'),
  }
}

function parseSourceLocator(value: unknown): ImageEditorV3SourceLocator {
  const source = parseRecord(value)
  if (source.kind === 'local-path') {
    if (typeof source.filePath !== 'string'
      || source.filePath.length === 0
      || source.filePath.length > MAX_LOCAL_PATH_CHARACTERS
      || source.filePath.includes('\0')
      || !path.isAbsolute(source.filePath)) {
      throw new Error('Invalid local image source path')
    }
    return { kind: 'local-path', filePath: source.filePath }
  }
  if (source.kind === 'http-url') {
    if (typeof source.url !== 'string' || source.url.length === 0 || source.url.length > MAX_HTTP_URL_CHARACTERS) {
      throw new Error('Invalid HTTP image source URL')
    }
    let parsed: URL
    try { parsed = new URL(source.url) } catch { throw new Error('Invalid HTTP image source URL') }
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password) {
      throw new Error('Invalid HTTP image source URL')
    }
    return { kind: 'http-url', url: parsed.href }
  }
  if (source.kind === 'data-url') {
    if (typeof source.dataUrl !== 'string'
      || source.dataUrl.length === 0
      || source.dataUrl.length > IMAGE_EDITOR_V3_MAX_DATA_URL_CHARACTERS) {
      throw new Error('Invalid or oversized image data URL')
    }
    return { kind: 'data-url', dataUrl: source.dataUrl }
  }
  throw new Error('Invalid image source locator kind')
}

export function parseImageEditorV3IngestSourcePayload(input: unknown): IngestSourcePayload {
  const record = parseRecord(input)
  return { requestId: readRequestId(record), source: parseSourceLocator(record.source) }
}

export function parseImageEditorV3PersistBrushTilesPayload(input: unknown): PersistBrushTilesPayload {
  const record = parseRecord(input)
  assertExactKeys(record, ['requestId', 'tiles'], 'brush tile persist payload')
  const requestId = readRequestId(record)
  let rawByteLength = 0
  const tiles = readBrushTileArray(record.tiles, 'brush tile persist').map((value) => {
    const item = parseRecord(value)
    assertExactKeys(item, ['tileKey', 'tile'], 'brush tile persist item')
    const tile = readBrushTile(item.tile)
    rawByteLength += tile.data.byteLength
    if (rawByteLength > MAX_BRUSH_REQUEST_RAW_BYTES) {
      throw new Error('Brush tile persist request exceeds raw byte budget')
    }
    return { tileKey: readBrushTileKey(item.tileKey), tile }
  })
  assertUniqueBrushTileKeys(tiles.map((item) => item.tileKey))
  return { requestId, tiles, rawByteLength }
}

export function parseImageEditorV3ReadBrushTilesPayload(input: unknown): ReadBrushTilesPayload {
  const record = parseRecord(input)
  assertExactKeys(record, ['requestId', 'tiles'], 'brush tile read payload')
  const requestId = readRequestId(record)
  let resourceByteLength = 0
  const tiles = readBrushTileArray(record.tiles, 'brush tile read').map((value) => {
    const item = parseRecord(value)
    assertExactKeys(item, ['tileKey', 'resource'], 'brush tile read item')
    const resource = parseRecord(item.resource)
    assertExactKeys(resource, ['resourceRef', 'byteSize'], 'brush tile resource')
    const byteSize = readSafeInteger(
      resource,
      'byteSize',
      80,
      IMAGE_EDIT_BRUSH_TILE_MAX_RESOURCE_BYTES_V3,
    )
    resourceByteLength += byteSize
    if (resourceByteLength > MAX_BRUSH_REQUEST_RESOURCE_BYTES) {
      throw new Error('Brush tile read request exceeds resource byte budget')
    }
    return {
      tileKey: readBrushTileKey(item.tileKey),
      resource: {
        resourceId: readResourceRef(resource.resourceRef, 'resourceRef'),
        byteSize,
      },
    }
  })
  assertUniqueBrushTileKeys(tiles.map((item) => item.tileKey))
  return {
    requestId,
    tiles,
    resourceByteLength,
    maximumDecodedByteLength: tiles.length * IMAGE_EDIT_BRUSH_TILE_MAX_RAW_BYTES_V3,
  }
}
