export function readString(record: Record<string, unknown>, field: string): string {
  const value = record[field]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Expected non-empty string field "${field}"`)
  }
  return value
}

export function readOptionalString(
  record: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = record[field]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`Expected string field "${field}"`)
  return value
}

export function readNumber(record: Record<string, unknown>, field: string): number {
  const value = record[field]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Expected finite number field "${field}"`)
  }
  return value
}

export function readOptionalNumber(
  record: Record<string, unknown>,
  field: string,
): number | undefined {
  const value = record[field]
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Expected finite number field "${field}"`)
  }
  return value
}

export function readOptionalBoolean(
  record: Record<string, unknown>,
  field: string,
): boolean | undefined {
  const value = record[field]
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw new Error(`Expected boolean field "${field}"`)
  return value
}

export function readBytes(record: Record<string, unknown>, field: string): Uint8Array {
  const value = record[field]
  if (!(value instanceof Uint8Array)) {
    throw new Error(`Expected Uint8Array field "${field}"`)
  }
  return value
}

export function readStringArray(record: Record<string, unknown>, field: string): string[] {
  const value = record[field]
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === 'string')) {
    throw new Error(`Expected string array field "${field}"`)
  }
  return value
}

export function readOptionalStringArray(
  record: Record<string, unknown>,
  field: string,
): string[] | undefined {
  const value = record[field]
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === 'string')) {
    throw new Error(`Expected string array field "${field}"`)
  }
  return value
}

export function readOptionalNumberArray(
  record: Record<string, unknown>,
  field: string,
): number[] | undefined {
  const value = record[field]
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) {
    throw new Error(`Expected finite number array field "${field}"`)
  }
  return value
}

export function readOptionalNumberTuple(
  record: Record<string, unknown>,
  field: string,
): [number, number, number, number] | undefined {
  const value = record[field]
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length !== 4 || value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) {
    throw new Error(`Expected four-number tuple field "${field}"`)
  }
  return value as [number, number, number, number]
}

export function readNotePlacement(
  value: unknown,
): MergeStoryboardImagesPayloadDto['notePlacement'] {
  if (value === undefined) return undefined
  if (value === 'overlay' || value === 'bottom') return value
  throw new Error('Expected notePlacement to be overlay or bottom')
}

export function readImageFit(value: unknown): MergeStoryboardImagesPayloadDto['imageFit'] {
  if (value === undefined) return undefined
  if (value === 'cover' || value === 'contain') return value
  throw new Error('Expected imageFit to be cover or contain')
}
import type { MergeStoryboardImagesPayloadDto } from '../services/image/types'
