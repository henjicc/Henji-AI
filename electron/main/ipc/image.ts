import {
  compressImageSource,
  cropImageSource,
  embedPanoramaImageMetadata,
  embedStoryboardImageMetadata,
  generateImageThumbnailBytes,
  loadImage,
  mergeStoryboardImages,
  persistImageBinary,
  persistImageSource,
  persistImageSourceTracked,
  prepareNodeImageBinary,
  prepareNodeImageSource,
  readImageInfo,
  readPanoramaImageMetadata,
  readStoryboardImageMetadata,
  saveImageSourceToAppDebugDir,
  saveImageSourceToDirectory,
  saveImageSourceToDownloads,
  savePanoramaImageSourceToDirectory,
  savePanoramaImageSourceToPath,
  saveImageSourceToPath,
  splitImage,
  splitImageSource,
} from '../services/image/ops'
import { composeLayerStack } from '../services/image/layer-stack'
import {
  composeLocalRedraw,
  prepareLocalRedraw,
  type ComposeLocalRedrawPayloadDto,
  type LocalRedrawAspectRatio,
  type LocalRedrawContextDto,
  type LocalRedrawSettingsDto,
  type PrepareLocalRedrawPayloadDto,
} from '../services/image/local-redraw'
import { releaseManagedGenerationMediaPaths, releaseManagedImagePaths } from '../services/image/path-utils'
import {
  probeSharpDiffusionFallback,
  renderSharpDiffusionFallback,
  type SharpDiffusionFallbackRequest,
} from '../services/image/diffusion-fallback'
import type {
  CropImageSourcePayloadDto,
  ComposeLayerStackPayloadDto,
  MergeStoryboardImagesPayloadDto,
  StoryboardImageMetadataDto,
} from '../services/image/types'
import { parseRecord, parseStringField, registerIpcHandler } from './registry'
import {
  readBytes,
  readImageFit,
  readNotePlacement,
  readNumber,
  readOptionalBoolean,
  readOptionalNumber,
  readOptionalNumberArray,
  readOptionalNumberTuple,
  readOptionalString,
  readOptionalStringArray,
  readString,
  readStringArray,
} from './image-payload-readers'

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

interface ReleaseLayerStackResourcesPayload {
  filePaths: string[]
}

const layerStackCompositionControllers = new Map<string, AbortController>()

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
  registerIpcHandler<PrepareLocalRedrawPayloadDto, Awaited<ReturnType<typeof prepareLocalRedraw>>>('image:prepareLocalRedraw', parsePrepareLocalRedrawPayload, prepareLocalRedraw)
  registerIpcHandler<ComposeLocalRedrawPayloadDto, Awaited<ReturnType<typeof composeLocalRedraw>>>('image:composeLocalRedraw', parseComposeLocalRedrawPayload, composeLocalRedraw)
  registerIpcHandler<MergeStoryboardImagesPayloadDto, Awaited<ReturnType<typeof mergeStoryboardImages>>>('image:mergeStoryboardImages', parseMergePayload, (payload) => {
    return mergeStoryboardImages(payload)
  })
  registerIpcHandler<string, Awaited<ReturnType<typeof readStoryboardImageMetadata>>>('image:readStoryboardImageMetadata', (input) => parseStringField(input, 'source'), (source) => {
    return readStoryboardImageMetadata(source)
  })
  registerIpcHandler<MetadataPayload, string>('image:embedStoryboardImageMetadata', parseMetadataPayload, ({ source, metadata }) => {
    return embedStoryboardImageMetadata(source, metadata)
  })
  registerIpcHandler<string, Awaited<ReturnType<typeof readPanoramaImageMetadata>>>('image:readPanoramaImageMetadata', (input) => parseStringField(input, 'source'), (source) => {
    return readPanoramaImageMetadata(source)
  })
  registerIpcHandler<string, Awaited<ReturnType<typeof embedPanoramaImageMetadata>>>('image:embedPanoramaImageMetadata', (input) => parseStringField(input, 'source'), (source) => {
    return embedPanoramaImageMetadata(source)
  })
  registerIpcHandler<string, string>('image:loadImage', (input) => parseStringField(input, 'filePath'), (filePath) => loadImage(filePath))
  registerIpcHandler<string, string>('image:persistImageSource', (input) => parseStringField(input, 'source'), (source) => persistImageSource(source))
  registerIpcHandler<string, Awaited<ReturnType<typeof persistImageSourceTracked>>>('image:persistImageSourceTracked', (input) => parseStringField(input, 'source'), (source) => persistImageSourceTracked(source))
  registerIpcHandler<BinaryPayload, string>('image:persistImageBinary', parseBinaryPayload, ({ bytes, extension }) => persistImageBinary(bytes, extension))
  registerIpcHandler<SaveSuggestedPayload, string>('image:saveImageSourceToDownloads', parseSaveSuggestedPayload, ({ source, suggestedFileName }) => {
    return saveImageSourceToDownloads(source, suggestedFileName)
  })
  registerIpcHandler<SavePathPayload, string>('image:saveImageSourceToPath', parseSavePathPayload, ({ source, targetPath }) => {
    return saveImageSourceToPath(source, targetPath)
  })
  registerIpcHandler<SavePathPayload, string>('image:savePanoramaImageSourceToPath', parseSavePathPayload, ({ source, targetPath }) => {
    return savePanoramaImageSourceToPath(source, targetPath)
  })
  registerIpcHandler<SaveDirectoryPayload, string>('image:saveImageSourceToDirectory', parseSaveDirectoryPayload, ({ source, targetDir, suggestedFileName }) => {
    return saveImageSourceToDirectory(source, targetDir, suggestedFileName)
  })
  registerIpcHandler<SaveDirectoryPayload, string>('image:savePanoramaImageSourceToDirectory', parseSaveDirectoryPayload, ({ source, targetDir, suggestedFileName }) => {
    return savePanoramaImageSourceToDirectory(source, targetDir, suggestedFileName)
  })
  registerIpcHandler<SaveDebugPayload, string>('image:saveImageSourceToAppDebugDir', parseSaveDebugPayload, ({ source, category, suggestedFileName }) => {
    return saveImageSourceToAppDebugDir(source, category, suggestedFileName)
  })
  registerIpcHandler<string, Awaited<ReturnType<typeof readImageInfo>>>('image:readImageInfo', (input) => parseStringField(input, 'source'), (source) => readImageInfo(source))
  registerIpcHandler<undefined, Awaited<ReturnType<typeof probeSharpDiffusionFallback>>>('image:probeDiffusionFallback', () => undefined, () => {
    return probeSharpDiffusionFallback()
  })
  registerIpcHandler<SharpDiffusionFallbackRequest, Awaited<ReturnType<typeof renderSharpDiffusionFallback>>>('image:renderDiffusionFallback', parseDiffusionFallbackPayload, (payload) => {
    return renderSharpDiffusionFallback(payload)
  })
  registerIpcHandler<CompressImageSourcePayload, Awaited<ReturnType<typeof compressImageSource>>>('image:compressImageSource', parseCompressImageSourcePayload, (payload) => {
    return compressImageSource(payload.source, {
      maxPixels: payload.maxPixels,
      quality: payload.quality,
      maxDimension: payload.maxDimension,
    })
  })
  registerIpcHandler<ThumbnailBytesPayload, { bytes: Uint8Array }>('image:generateThumbnailBytes', parseThumbnailBytesPayload, async ({ source, maxSize }) => {
    const bytes = await generateImageThumbnailBytes(source, maxSize)
    return { bytes }
  })
  registerIpcHandler<ComposeLayerStackPayloadDto, Awaited<ReturnType<typeof composeLayerStack>>>('image:composeLayerStack', parseComposeLayerStackPayload, async (payload) => {
    if (layerStackCompositionControllers.has(payload.requestId)) {
      throw new Error(`图层栈合成请求重复：${payload.requestId}`)
    }
    const controller = new AbortController()
    layerStackCompositionControllers.set(payload.requestId, controller)
    try {
      return await composeLayerStack(payload, controller.signal)
    } finally {
      if (layerStackCompositionControllers.get(payload.requestId) === controller) {
        layerStackCompositionControllers.delete(payload.requestId)
      }
    }
  })
  registerIpcHandler<string, void>('image:cancelLayerStackComposition', (input) => parseStringField(input, 'requestId'), (requestId) => {
    layerStackCompositionControllers.get(requestId)?.abort()
  })
  registerIpcHandler<ReleaseLayerStackResourcesPayload, void>('image:releaseLayerStackResources', (input) => {
    const record = parseRecord(input)
    return { filePaths: readStringArray(record, 'filePaths') }
  }, ({ filePaths }) => {
    releaseManagedImagePaths(filePaths)
  })
  registerIpcHandler<ReleaseLayerStackResourcesPayload, void>('image:releaseManagedGenerationMedia', (input) => {
    const record = parseRecord(input)
    return { filePaths: readStringArray(record, 'filePaths') }
  }, ({ filePaths }) => {
    releaseManagedGenerationMediaPaths(filePaths)
  })
}

function parseDiffusionFallbackPayload(input: unknown): SharpDiffusionFallbackRequest {
  const record = parseRecord(input)
  const purpose = record.purpose
  const format = record.format
  if (purpose !== 'preview' && purpose !== 'export') {
    throw new Error('Expected purpose to be preview or export')
  }
  if (format !== 'png' && format !== 'jpeg' && format !== 'webp') {
    throw new Error('Expected format to be png, jpeg or webp')
  }
  return {
    requestId: readString(record, 'requestId'),
    source: readString(record, 'source'),
    purpose,
    format,
    quality: readOptionalNumber(record, 'quality'),
    maxPreviewPixels: readOptionalNumber(record, 'maxPreviewPixels'),
    params: record.params,
  }
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

function parseLocalRedrawSettings(value: unknown): LocalRedrawSettingsDto {
  const record = parseRecord(value)
  const aspectRatio = readString(record, 'aspectRatio')
  const registrationQuality = readString(record, 'registrationQuality')
  const allowedRatios: LocalRedrawAspectRatio[] = ['auto', '1:1', '4:3', '3:4', '16:9', '9:16']
  if (!allowedRatios.includes(aspectRatio as LocalRedrawAspectRatio)) throw new Error('Invalid local redraw aspect ratio')
  if (!['fast', 'precise', 'extreme'].includes(registrationQuality)) throw new Error('Invalid registration quality')
  return {
    contextScale: Math.max(1, Math.min(5, readNumber(record, 'contextScale'))),
    aspectRatio: aspectRatio as LocalRedrawAspectRatio,
    registrationQuality: registrationQuality as LocalRedrawSettingsDto['registrationQuality'],
    featherPixels: Math.max(0, Math.min(128, readNumber(record, 'featherPixels'))),
    forceRegistration: readOptionalBoolean(record, 'forceRegistration') === true,
  }
}

function parsePrepareLocalRedrawPayload(input: unknown): PrepareLocalRedrawPayloadDto {
  const record = parseRecord(input)
  return {
    source: readString(record, 'source'),
    mask: readString(record, 'mask'),
    settings: parseLocalRedrawSettings(record.settings),
    preferredAspectRatios: readOptionalNumberArray(record, 'preferredAspectRatios'),
  }
}

function parseComposeLocalRedrawPayload(input: unknown): ComposeLocalRedrawPayloadDto {
  const record = parseRecord(input)
  const rawContext = parseRecord(record.context)
  if (readNumber(rawContext, 'version') !== 2) throw new Error('Invalid local redraw context version')
  const rawCrop = parseRecord(rawContext.crop)
  const context: LocalRedrawContextDto = {
    version: 2,
    requestId: readString(rawContext, 'requestId'),
    source: readString(rawContext, 'source'),
    mask: readString(rawContext, 'mask'),
    sourceWidth: readNumber(rawContext, 'sourceWidth'),
    sourceHeight: readNumber(rawContext, 'sourceHeight'),
    crop: {
      x: readNumber(rawCrop, 'x'),
      y: readNumber(rawCrop, 'y'),
      width: readNumber(rawCrop, 'width'),
      height: readNumber(rawCrop, 'height'),
    },
    matchedAspectRatio: readOptionalNumber(rawContext, 'matchedAspectRatio') ?? null,
    settings: parseLocalRedrawSettings(rawContext.settings),
  }
  return { generatedSource: readString(record, 'generatedSource'), context }
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

interface ThumbnailBytesPayload {
  source: string
  maxSize?: number
}

function parseThumbnailBytesPayload(input: unknown): ThumbnailBytesPayload {
  const record = parseRecord(input)
  return {
    source: readString(record, 'source'),
    maxSize: readOptionalNumber(record, 'maxSize'),
  }
}

function parseComposeLayerStackPayload(input: unknown): ComposeLayerStackPayloadDto {
  const record = parseRecord(input)
  if (!Array.isArray(record.layers)) throw new Error('Expected array field "layers"')
  return {
    requestId: readString(record, 'requestId'),
    stackId: readString(record, 'stackId'),
    thumbnailMaxSize: readOptionalNumber(record, 'thumbnailMaxSize'),
    persistSourceLayers: readOptionalBoolean(record, 'persistSourceLayers'),
    layers: record.layers.map((value) => {
      const layer = parseRecord(value)
      const role = layer.role
      const declaredFormat = layer.declaredFormat
      if (role !== 'base' && role !== 'content') throw new Error('Expected layer role to be base or content')
      if (declaredFormat !== 'png' && declaredFormat !== 'jpeg' && declaredFormat !== 'webp') throw new Error('Expected declaredFormat to be png, jpeg or webp')
      const boundingBox = layer.boundingBox === undefined ? undefined : parseRecord(layer.boundingBox)
      return {
        sourceOutputIndex: readNumber(layer, 'sourceOutputIndex'),
        source: readString(layer, 'source'),
        zIndex: readNumber(layer, 'zIndex'),
        role,
        name: readOptionalString(layer, 'name'),
        description: readOptionalString(layer, 'description'),
        declaredWidth: readNumber(layer, 'declaredWidth'),
        declaredHeight: readNumber(layer, 'declaredHeight'),
        declaredFormat,
        opacity: readOptionalNumber(layer, 'opacity'),
        visible: readOptionalBoolean(layer, 'visible'),
        ...(boundingBox ? {
          boundingBox: {
            absolute: readOptionalNumberTuple(boundingBox, 'absolute'),
            normalized: readOptionalNumberTuple(boundingBox, 'normalized'),
          },
        } : {}),
      }
    }),
  }
}
