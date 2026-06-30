import {
  compressImageSource,
  cropImageSource,
  embedStoryboardImageMetadata,
  loadImage,
  mergeStoryboardImages,
  persistImageBinary,
  persistImageSource,
  prepareNodeImageBinary,
  prepareNodeImageSource,
  readImageInfo,
  readStoryboardImageMetadata,
  saveImageSourceToAppDebugDir,
  saveImageSourceToDirectory,
  saveImageSourceToDownloads,
  saveImageSourceToPath,
  splitImage,
  splitImageSource,
} from '../services/image/ops'
import type {
  CropImageSourcePayloadDto,
  MergeStoryboardImagesPayloadDto,
  StoryboardImageMetadataDto,
} from '../services/image/types'
import { parseRecord, parseStringField, registerIpcHandler } from './registry'

interface SplitPayload {
  rows: number
  cols: number
  lineThickness: number
}

interface SplitImagePayload extends SplitPayload {
  imageBase64: string
}

interface SplitImageSourcePayload extends SplitPayload {
  source: string
}

interface SourceMaxPayload {
  source: string
  maxPreviewDimension: number
}

interface BinaryMaxPayload {
  bytes: Uint8Array
  extension?: string
  maxPreviewDimension: number
}

interface BinaryPayload {
  bytes: Uint8Array
  extension: string
}

interface MetadataPayload {
  source: string
  metadata: StoryboardImageMetadataDto
}

interface SavePathPayload {
  source: string
  targetPath: string
}

interface SaveDirectoryPayload {
  source: string
  targetDir: string
  suggestedFileName?: string
}

interface SaveSuggestedPayload {
  source: string
  suggestedFileName?: string
}

interface SaveDebugPayload extends SaveSuggestedPayload {
  category: string
}

export function registerImageIpc(): void {
  registerIpcHandler<SplitImagePayload, string[]>('image:splitImage', parseSplitImagePayload, ({ imageBase64, rows, cols, lineThickness }) => {
    return splitImage(imageBase64, rows, cols, lineThickness)
  })
  registerIpcHandler<SplitImageSourcePayload, string[]>('image:splitImageSource', parseSplitImageSourcePayload, ({ source, rows, cols, lineThickness }) => {
    return splitImageSource(source, rows, cols, lineThickness)
  })
  registerIpcHandler<SourceMaxPayload, Awaited<ReturnType<typeof prepareNodeImageSource>>>('image:prepareNodeImageSource', parseSourceMaxPayload, ({ source, maxPreviewDimension }) => {
    return prepareNodeImageSource(source, maxPreviewDimension)
  })
  registerIpcHandler<BinaryMaxPayload, Awaited<ReturnType<typeof prepareNodeImageBinary>>>('image:prepareNodeImageBinary', parseBinaryMaxPayload, ({ bytes, extension, maxPreviewDimension }) => {
    return prepareNodeImageBinary(bytes, extension, maxPreviewDimension)
  })
  registerIpcHandler<CropImageSourcePayloadDto, string>('image:cropImageSource', parseCropPayload, (payload) => cropImageSource(payload))
  registerIpcHandler<MergeStoryboardImagesPayloadDto, Awaited<ReturnType<typeof mergeStoryboardImages>>>('image:mergeStoryboardImages', parseMergePayload, (payload) => {
    return mergeStoryboardImages(payload)
  })
  registerIpcHandler<string, Awaited<ReturnType<typeof readStoryboardImageMetadata>>>('image:readStoryboardImageMetadata', (input) => parseStringField(input, 'source'), (source) => {
    return readStoryboardImageMetadata(source)
  })
  registerIpcHandler<MetadataPayload, string>('image:embedStoryboardImageMetadata', parseMetadataPayload, ({ source, metadata }) => {
    return embedStoryboardImageMetadata(source, metadata)
  })
  registerIpcHandler<string, string>('image:loadImage', (input) => parseStringField(input, 'filePath'), (filePath) => loadImage(filePath))
  registerIpcHandler<string, string>('image:persistImageSource', (input) => parseStringField(input, 'source'), (source) => persistImageSource(source))
  registerIpcHandler<BinaryPayload, string>('image:persistImageBinary', parseBinaryPayload, ({ bytes, extension }) => persistImageBinary(bytes, extension))
  registerIpcHandler<SaveSuggestedPayload, string>('image:saveImageSourceToDownloads', parseSaveSuggestedPayload, ({ source, suggestedFileName }) => {
    return saveImageSourceToDownloads(source, suggestedFileName)
  })
  registerIpcHandler<SavePathPayload, string>('image:saveImageSourceToPath', parseSavePathPayload, ({ source, targetPath }) => {
    return saveImageSourceToPath(source, targetPath)
  })
  registerIpcHandler<SaveDirectoryPayload, string>('image:saveImageSourceToDirectory', parseSaveDirectoryPayload, ({ source, targetDir, suggestedFileName }) => {
    return saveImageSourceToDirectory(source, targetDir, suggestedFileName)
  })
  registerIpcHandler<SaveDebugPayload, string>('image:saveImageSourceToAppDebugDir', parseSaveDebugPayload, ({ source, category, suggestedFileName }) => {
    return saveImageSourceToAppDebugDir(source, category, suggestedFileName)
  })
  registerIpcHandler<string, Awaited<ReturnType<typeof readImageInfo>>>('image:readImageInfo', (input) => parseStringField(input, 'source'), (source) => readImageInfo(source))
  registerIpcHandler<CompressImageSourcePayload, Awaited<ReturnType<typeof compressImageSource>>>('image:compressImageSource', parseCompressImageSourcePayload, (payload) => {
    return compressImageSource(payload.source, {
      maxPixels: payload.maxPixels,
      quality: payload.quality,
      maxDimension: payload.maxDimension,
    })
  })
}

function parseSplitImagePayload(input: unknown): SplitImagePayload {
  const record = parseRecord(input)
  return {
    imageBase64: readString(record, 'imageBase64'),
    ...readSplitPayload(record),
  }
}

function parseSplitImageSourcePayload(input: unknown): SplitImageSourcePayload {
  const record = parseRecord(input)
  return {
    source: readString(record, 'source'),
    ...readSplitPayload(record),
  }
}

function readSplitPayload(record: Record<string, unknown>): SplitPayload {
  return {
    rows: readNumber(record, 'rows'),
    cols: readNumber(record, 'cols'),
    lineThickness: readOptionalNumber(record, 'lineThickness') ?? 0,
  }
}

function parseSourceMaxPayload(input: unknown): SourceMaxPayload {
  const record = parseRecord(input)
  return {
    source: readString(record, 'source'),
    maxPreviewDimension: readOptionalNumber(record, 'maxPreviewDimension') ?? 512,
  }
}

function parseBinaryMaxPayload(input: unknown): BinaryMaxPayload {
  const record = parseRecord(input)
  return {
    bytes: readBytes(record, 'bytes'),
    extension: readOptionalString(record, 'extension'),
    maxPreviewDimension: readOptionalNumber(record, 'maxPreviewDimension') ?? 512,
  }
}

function parseBinaryPayload(input: unknown): BinaryPayload {
  const record = parseRecord(input)
  return {
    bytes: readBytes(record, 'bytes'),
    extension: readOptionalString(record, 'extension') ?? 'png',
  }
}

function parseCropPayload(input: unknown): CropImageSourcePayloadDto {
  const record = parseRecord(input)
  return {
    source: readString(record, 'source'),
    aspectRatio: readOptionalString(record, 'aspectRatio'),
    cropX: readOptionalNumber(record, 'cropX'),
    cropY: readOptionalNumber(record, 'cropY'),
    cropWidth: readOptionalNumber(record, 'cropWidth'),
    cropHeight: readOptionalNumber(record, 'cropHeight'),
  }
}

function parseMergePayload(input: unknown): MergeStoryboardImagesPayloadDto {
  const record = parseRecord(input)
  return {
    frameSources: readStringArray(record, 'frameSources'),
    rows: readNumber(record, 'rows'),
    cols: readNumber(record, 'cols'),
    cellGap: readNumber(record, 'cellGap'),
    outerPadding: readNumber(record, 'outerPadding'),
    noteHeight: readNumber(record, 'noteHeight'),
    fontSize: readNumber(record, 'fontSize'),
    backgroundColor: readString(record, 'backgroundColor'),
    maxDimension: readNumber(record, 'maxDimension'),
    showFrameIndex: readOptionalBoolean(record, 'showFrameIndex'),
    showFrameNote: readOptionalBoolean(record, 'showFrameNote'),
    notePlacement: readNotePlacement(record.notePlacement),
    imageFit: readImageFit(record.imageFit),
    frameIndexPrefix: readOptionalString(record, 'frameIndexPrefix'),
    textColor: readOptionalString(record, 'textColor'),
    frameNotes: readOptionalStringArray(record, 'frameNotes'),
  }
}

function parseMetadataPayload(input: unknown): MetadataPayload {
  const record = parseRecord(input)
  const metadata = parseRecord(record.metadata)
  return {
    source: readString(record, 'source'),
    metadata: {
      gridRows: readNumber(metadata, 'gridRows'),
      gridCols: readNumber(metadata, 'gridCols'),
      frameNotes: readStringArray(metadata, 'frameNotes'),
    },
  }
}

function parseSaveSuggestedPayload(input: unknown): SaveSuggestedPayload {
  const record = parseRecord(input)
  return {
    source: readString(record, 'source'),
    suggestedFileName: readOptionalString(record, 'suggestedFileName'),
  }
}

function parseSavePathPayload(input: unknown): SavePathPayload {
  const record = parseRecord(input)
  return {
    source: readString(record, 'source'),
    targetPath: readString(record, 'targetPath'),
  }
}

function parseSaveDirectoryPayload(input: unknown): SaveDirectoryPayload {
  const record = parseRecord(input)
  return {
    source: readString(record, 'source'),
    targetDir: readString(record, 'targetDir'),
    suggestedFileName: readOptionalString(record, 'suggestedFileName'),
  }
}

function parseSaveDebugPayload(input: unknown): SaveDebugPayload {
  const record = parseRecord(input)
  return {
    source: readString(record, 'source'),
    category: readOptionalString(record, 'category') ?? 'grid',
    suggestedFileName: readOptionalString(record, 'suggestedFileName'),
  }
}

function readString(record: Record<string, unknown>, field: string): string {
  const value = record[field]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Expected non-empty string field "${field}"`)
  }
  return value
}

function readOptionalString(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`Expected string field "${field}"`)
  return value
}

function readNumber(record: Record<string, unknown>, field: string): number {
  const value = record[field]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Expected finite number field "${field}"`)
  }
  return value
}

function readOptionalNumber(record: Record<string, unknown>, field: string): number | undefined {
  const value = record[field]
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Expected finite number field "${field}"`)
  }
  return value
}

function readOptionalBoolean(record: Record<string, unknown>, field: string): boolean | undefined {
  const value = record[field]
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw new Error(`Expected boolean field "${field}"`)
  return value
}

function readBytes(record: Record<string, unknown>, field: string): Uint8Array {
  const value = record[field]
  if (!(value instanceof Uint8Array)) {
    throw new Error(`Expected Uint8Array field "${field}"`)
  }
  return value
}

function readStringArray(record: Record<string, unknown>, field: string): string[] {
  const value = record[field]
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === 'string')) {
    throw new Error(`Expected string array field "${field}"`)
  }
  return value
}

function readOptionalStringArray(record: Record<string, unknown>, field: string): string[] | undefined {
  const value = record[field]
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === 'string')) {
    throw new Error(`Expected string array field "${field}"`)
  }
  return value
}

function readNotePlacement(value: unknown): MergeStoryboardImagesPayloadDto['notePlacement'] {
  if (value === undefined) return undefined
  if (value === 'overlay' || value === 'bottom') return value
  throw new Error('Expected notePlacement to be overlay or bottom')
}

function readImageFit(value: unknown): MergeStoryboardImagesPayloadDto['imageFit'] {
  if (value === undefined) return undefined
  if (value === 'cover' || value === 'contain') return value
  throw new Error('Expected imageFit to be cover or contain')
}

interface CompressImageSourcePayload {
  source: string
  maxPixels?: number
  quality?: number
  maxDimension?: number
}

function parseCompressImageSourcePayload(input: unknown): CompressImageSourcePayload {
  const record = parseRecord(input)
  return {
    source: readString(record, 'source'),
    maxPixels: readOptionalNumber(record, 'maxPixels'),
    quality: readOptionalNumber(record, 'quality'),
    maxDimension: readOptionalNumber(record, 'maxDimension'),
  }
}
