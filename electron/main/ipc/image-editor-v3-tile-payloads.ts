import { parseRecord } from './registry'
import {
  parseImageEditorV3BasePayload,
  parseImageEditorV3TilePayload,
  type TilePayload,
} from './image-editor-v3-payloads'

const MAX_SOURCE_TILE_BATCH = 16
const MAX_PYRAMID_PREWARM_TILES = 4_096

export interface TileBatchPayload {
  requestId: string
  tiles: Array<Omit<TilePayload, 'requestId'> & { priority: number }>
}

export interface PyramidPrewarmPayload {
  requestId: string
  resourceRef: TilePayload['resourceRef']
  minimumMip?: number
  maximumMip?: number
  tileBudget?: number
  bitDepth?: 8 | 16 | 32
}

function assertExactKeys(record: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const allowedKeys = new Set(allowed)
  const unknown = Object.keys(record).find((key) => !allowedKeys.has(key))
  if (unknown) throw new Error(`Invalid ${label}: unknown field ${unknown}`)
}

function readPriority(record: Record<string, unknown>): number {
  const value = record.priority
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 1_000_000) {
    throw new Error('Invalid priority')
  }
  return value as number
}

function readInteger(value: unknown, field: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`Invalid ${field}`)
  }
  return value as number
}

export function parseImageEditorV3PyramidPrewarmPayload(input: unknown): PyramidPrewarmPayload {
  const record = parseRecord(input)
  assertExactKeys(record, [
    'requestId', 'resourceRef', 'minimumMip', 'maximumMip', 'tileBudget', 'bitDepth',
  ], 'source pyramid prewarm payload')
  const resource = parseImageEditorV3TilePayload({
    requestId: record.requestId,
    resourceRef: record.resourceRef,
    mip: 0,
    tileX: 0,
    tileY: 0,
  })
  const minimumMip = record.minimumMip === undefined
    ? undefined
    : readInteger(record.minimumMip, 'minimumMip', 0, 30)
  const maximumMip = record.maximumMip === undefined
    ? undefined
    : readInteger(record.maximumMip, 'maximumMip', 0, 30)
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
    requestId: resource.requestId,
    resourceRef: resource.resourceRef,
    minimumMip,
    maximumMip,
    tileBudget: record.tileBudget === undefined
      ? undefined
      : readInteger(record.tileBudget, 'tileBudget', 1, MAX_PYRAMID_PREWARM_TILES),
    bitDepth,
  }
}

export function parseImageEditorV3TileBatchPayload(input: unknown): TileBatchPayload {
  const record = parseRecord(input)
  assertExactKeys(record, ['requestId', 'tiles'], 'source tile batch payload')
  const { requestId } = parseImageEditorV3BasePayload(record)
  if (!Array.isArray(record.tiles)
    || record.tiles.length < 1
    || record.tiles.length > MAX_SOURCE_TILE_BATCH) {
    throw new Error('Invalid source tile batch size')
  }
  const tiles = record.tiles.map((value, index) => {
    const item = parseRecord(value)
    assertExactKeys(item, [
      'resourceRef', 'mip', 'tileX', 'tileY', 'halo', 'bitDepth', 'priority',
    ], 'source tile batch item')
    const priority = readPriority(item)
    const { requestId: _ignored, ...tile } = parseImageEditorV3TilePayload({
      ...item,
      requestId: `batch:${index}`,
    })
    return { ...tile, priority }
  })
  const keys = tiles.map((tile) => [
    tile.resourceRef, tile.mip, tile.tileX, tile.tileY, tile.halo, tile.bitDepth ?? 8,
  ].join(':'))
  if (new Set(keys).size !== keys.length) throw new Error('Source tile batch contains duplicates')
  return { requestId, tiles }
}
