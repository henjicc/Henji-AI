import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import sharp, { type OverlayOptions, type Region } from 'sharp'
import {
  ensureOutputPathWithExtension,
  ensureUniquePath,
  getDebugDir,
  getDataRootDir,
  mimeFromExtension,
  normalizeExtension,
  persistImageBytes,
  sanitizeFileStem,
  writeBytesToPath,
} from './path-utils'
import { encodePngWithStoryboardMetadata, readStoryboardMetadataFromPng } from './png-metadata'
import { isLocalSource, normalizeLocalSource, resolveSourceBytes } from './source'
import type {
  CropImageSourcePayloadDto,
  ImageInfoResultDto,
  MergeStoryboardImagesPayloadDto,
  MergeStoryboardImagesResultDto,
  PrepareNodeImageSourceResultDto,
  StoryboardImageMetadataDto,
} from './types'

/* eslint-disable no-restricted-syntax -- Image rendering service needs concrete pixel colors for generated PNG overlays. */
const DEFAULT_BACKGROUND_COLOR = '#0f172a'
const DEFAULT_TEXT_COLOR = '#f8fafc'
/* eslint-enable no-restricted-syntax */

export async function loadImage(filePath: string): Promise<string> {
  const localPath = normalizeLocalSource(filePath)
  const bytes = fs.readFileSync(localPath)
  return `data:${mimeFromExtension(path.extname(localPath))};base64,${bytes.toString('base64')}`
}

export async function persistImageSource(source: string): Promise<string> {
  const { bytes, extension } = await resolveSourceBytes(source)
  return persistImageBytes(bytes, extension)
}

export async function persistImageBinary(bytes: Uint8Array, extension = 'png'): Promise<string> {
  return persistImageBytes(Buffer.from(bytes), extension)
}

export async function splitImage(imageBase64: string, rows: number, cols: number, lineThickness = 0): Promise<string[]> {
  const bytes = decodeBase64Payload(imageBase64)
  const frames = await splitBuffer(bytes, rows, cols, lineThickness)
  return frames.map((frame) => `data:image/png;base64,${frame.toString('base64')}`)
}

export async function splitImageSource(source: string, rows: number, cols: number, lineThickness = 0): Promise<string[]> {
  const { bytes } = await resolveSourceBytes(source)
  const frames = await splitBuffer(bytes, rows, cols, lineThickness)
  return frames.map((frame) => persistImageBytes(frame, 'png'))
}

export async function prepareNodeImageSource(source: string, maxPreviewDimension = 512): Promise<PrepareNodeImageSourceResultDto> {
  const { bytes, extension } = await resolveSourceBytes(source)
  return await prepareFromBytes(bytes, extension, maxPreviewDimension)
}

export async function prepareNodeImageBinary(
  bytes: Uint8Array,
  extension = 'png',
  maxPreviewDimension = 512
): Promise<PrepareNodeImageSourceResultDto> {
  return await prepareFromBytes(Buffer.from(bytes), extension, maxPreviewDimension)
}

export async function cropImageSource(payload: CropImageSourcePayloadDto): Promise<string> {
  const { bytes } = await resolveSourceBytes(payload.source)
  const meta = await sharp(bytes).metadata()
  const width = Math.max(1, meta.width ?? 1)
  const height = Math.max(1, meta.height ?? 1)
  const region = resolveCropRegion(payload, width, height)
  const output = await sharp(bytes).extract(region).png().toBuffer()
  return persistImageBytes(output, 'png')
}

export async function readStoryboardImageMetadata(source: string): Promise<StoryboardImageMetadataDto | null> {
  const { bytes, extension } = await resolveSourceBytes(source)
  if (normalizeExtension(extension) !== 'png') return null
  return readStoryboardMetadataFromPng(bytes)
}

export async function embedStoryboardImageMetadata(source: string, metadata: StoryboardImageMetadataDto): Promise<string> {
  const { bytes } = await resolveSourceBytes(source)
  const encoded = await encodePngWithStoryboardMetadata(bytes, metadata)
  return persistImageBytes(encoded, 'png')
}

export async function saveImageSourceToDownloads(source: string, suggestedFileName?: string): Promise<string> {
  const targetDir = app.getPath('downloads') || path.join(getDataRootDir(), 'Downloads')
  return await saveImageSourceToDirectory(source, targetDir, suggestedFileName)
}

export async function saveImageSourceToPath(source: string, targetPath: string): Promise<string> {
  const { bytes, extension } = await resolveSourceBytes(source)
  const outputPath = ensureOutputPathWithExtension(targetPath.trim(), extension)
  writeBytesToPath(outputPath, bytes)
  return outputPath
}

export async function saveImageSourceToDirectory(
  source: string,
  targetDir: string,
  suggestedFileName?: string
): Promise<string> {
  const { bytes, extension } = await resolveSourceBytes(source)
  fs.mkdirSync(targetDir, { recursive: true })
  const stem = makeOutputStem(suggestedFileName, 'storyboard')
  const outputPath = ensureUniquePath(path.join(targetDir, `${stem}.${normalizeExtension(extension)}`))
  writeBytesToPath(outputPath, bytes)
  return outputPath
}

export async function saveImageSourceToAppDebugDir(
  source: string,
  category = 'grid',
  suggestedFileName?: string
): Promise<string> {
  return await saveImageSourceToDirectory(source, getDebugDir(category || 'grid'), suggestedFileName)
}

export async function readImageInfo(source: string): Promise<ImageInfoResultDto> {
  const { bytes, extension } = await resolveSourceBytes(source)
  const meta = await sharp(bytes).metadata()
  const localPath = isLocalSource(source) ? normalizeLocalSource(source) : null
  const stat = localPath && fs.existsSync(localPath) ? fs.statSync(localPath) : null
  return {
    source: source.trim(),
    fileName: localPath ? path.basename(localPath) : null,
    extension: normalizeExtension(extension),
    width: Math.max(1, meta.width ?? 1),
    height: Math.max(1, meta.height ?? 1),
    fileSizeBytes: bytes.length,
    createdAt: stat ? stat.birthtimeMs : null,
    modifiedAt: stat ? stat.mtimeMs : null,
  }
}

export async function mergeStoryboardImages(payload: MergeStoryboardImagesPayloadDto): Promise<MergeStoryboardImagesResultDto> {
  const layout = await resolveMergeLayout(payload)
  const base = sharp({
    create: {
      width: layout.canvasWidth,
      height: layout.canvasHeight,
      channels: 4,
      background: payload.backgroundColor || DEFAULT_BACKGROUND_COLOR,
    },
  })
  const composites = await buildFrameComposites(payload, layout)
  const overlays = buildTextOverlaySvg(payload, layout)
  const png = await base.composite([...composites, ...overlays]).png().toBuffer()
  const metadata = buildStoryboardMetadata(payload, layout.frameCount)
  const encoded = await encodePngWithStoryboardMetadata(png, metadata)
  return {
    imagePath: persistImageBytes(encoded, 'png'),
    canvasWidth: layout.canvasWidth,
    canvasHeight: layout.canvasHeight,
    cellWidth: layout.cellWidth,
    cellHeight: layout.cellHeight,
    gap: layout.gap,
    padding: layout.padding,
    noteHeight: layout.noteHeight,
    fontSize: layout.fontSize,
    textOverlayApplied: Boolean(payload.showFrameIndex || payload.showFrameNote),
    metadataEmbedded: true,
  }
}

async function splitBuffer(bytes: Buffer, rows: number, cols: number, lineThickness: number): Promise<Buffer[]> {
  const safeRows = Math.max(1, Math.floor(rows))
  const safeCols = Math.max(1, Math.floor(cols))
  const safeLine = Math.max(0, Math.floor(lineThickness))
  const meta = await sharp(bytes).metadata()
  const width = Math.max(1, meta.width ?? 1)
  const height = Math.max(1, meta.height ?? 1)
  const line = resolveLineThickness(width, height, safeRows, safeCols, safeLine)
  const usableWidth = width - (safeCols - 1) * line
  const usableHeight = height - (safeRows - 1) * line
  const colSizes = splitSizes(usableWidth, safeCols)
  const rowSizes = splitSizes(usableHeight, safeRows)
  const outputs: Buffer[] = []
  for (let row = 0, y = 0; row < safeRows; row += 1) {
    for (let col = 0, x = 0; col < safeCols; col += 1) {
      outputs.push(await sharp(bytes).extract({ left: x, top: y, width: colSizes[col], height: rowSizes[row] }).png().toBuffer())
      x += colSizes[col] + line
    }
    y += rowSizes[row] + line
  }
  return outputs
}

async function prepareFromBytes(bytes: Buffer, extension: string, maxPreviewDimension: number): Promise<PrepareNodeImageSourceResultDto> {
  const meta = await sharp(bytes).metadata()
  const width = Math.max(1, meta.width ?? 1)
  const height = Math.max(1, meta.height ?? 1)
  const imagePath = persistImageBytes(bytes, extension)
  const safeMax = Math.max(64, Math.floor(maxPreviewDimension))
  if (Math.max(width, height) <= safeMax) {
    return { imagePath, previewImagePath: imagePath, aspectRatio: reduceAspectRatio(width, height) }
  }
  const preview = await sharp(bytes).resize(safeMax, safeMax, { fit: 'inside' }).jpeg({ quality: 86 }).toBuffer()
  return {
    imagePath,
    previewImagePath: persistImageBytes(preview, 'jpg'),
    aspectRatio: reduceAspectRatio(width, height),
  }
}

function decodeBase64Payload(input: string): Buffer {
  const payload = input.includes(',') ? input.split(',').pop() ?? '' : input
  if (!payload) throw new Error('Image base64 payload is empty')
  return Buffer.from(payload, 'base64')
}

function splitSizes(total: number, segments: number): number[] {
  const base = Math.floor(total / segments)
  const remainder = total % segments
  return Array.from({ length: segments }, (_item, index) => base + (index < remainder ? 1 : 0))
}

function resolveLineThickness(width: number, height: number, rows: number, cols: number, requested: number): number {
  const maxByWidth = cols > 1 ? Math.floor((width - cols) / (cols - 1)) : Number.MAX_SAFE_INTEGER
  const maxByHeight = rows > 1 ? Math.floor((height - rows) / (rows - 1)) : Number.MAX_SAFE_INTEGER
  const line = Math.max(0, Math.min(requested, maxByWidth, maxByHeight))
  if (width - (cols - 1) * line < cols || height - (rows - 1) * line < rows) {
    throw new Error('分割线过粗，无法切割')
  }
  return line
}

function reduceAspectRatio(width: number, height: number): string {
  let a = Math.max(1, Math.round(width))
  let b = Math.max(1, Math.round(height))
  while (b !== 0) {
    const t = b
    b = a % b
    a = t
  }
  return `${Math.round(width / a)}:${Math.round(height / a)}`
}

function parseAspectRatio(value: string | undefined): number | null {
  if (!value || value === 'free') return null
  const [wRaw = '1', hRaw = '1'] = value.split(':')
  const w = Number(wRaw)
  const h = Number(hRaw)
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? w / h : null
}

function resolveCropRegion(payload: CropImageSourcePayloadDto, width: number, height: number): Region {
  const { cropX, cropY, cropWidth, cropHeight } = payload
  if (
    isPositiveNumber(cropX) &&
    isPositiveNumber(cropY) &&
    isPositiveNumber(cropWidth) &&
    isPositiveNumber(cropHeight)
  ) {
    const left = Math.max(0, Math.min(width - 1, Math.floor(cropX)))
    const top = Math.max(0, Math.min(height - 1, Math.floor(cropY)))
    return {
      left,
      top,
      width: Math.max(1, Math.min(width - left, Math.floor(cropWidth))),
      height: Math.max(1, Math.min(height - top, Math.floor(cropHeight))),
    }
  }
  const targetRatio = parseAspectRatio(payload.aspectRatio)
  if (!targetRatio) return { left: 0, top: 0, width, height }
  const sourceRatio = width / Math.max(1, height)
  if (sourceRatio > targetRatio) {
    const cropWidth = Math.max(1, Math.floor(height * targetRatio))
    return { left: Math.floor((width - cropWidth) / 2), top: 0, width: cropWidth, height }
  }
  const ratioCropHeight = Math.max(1, Math.floor(width / targetRatio))
  return { left: 0, top: Math.floor((height - ratioCropHeight) / 2), width, height: ratioCropHeight }
}

function isPositiveNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function makeOutputStem(suggestedFileName: string | undefined, prefix: string): string {
  const stem = sanitizeFileStem((suggestedFileName ?? '').replace(/\.[^.]+$/, ''))
  return stem === 'storyboard-image' ? `${prefix}-${Date.now()}` : stem
}

interface MergeLayout {
  rows: number
  cols: number
  frameCount: number
  cellWidth: number
  cellHeight: number
  gap: number
  padding: number
  noteHeight: number
  fontSize: number
  canvasWidth: number
  canvasHeight: number
}

async function resolveMergeLayout(payload: MergeStoryboardImagesPayloadDto): Promise<MergeLayout> {
  const rows = Math.max(1, Math.floor(payload.rows))
  const cols = Math.max(1, Math.floor(payload.cols))
  const frameCount = Math.max(1, rows * cols)
  const firstSource = payload.frameSources.slice(0, frameCount).find((source) => source.trim())
  if (!firstSource) throw new Error('没有可合并的分镜图片')
  const { bytes } = await resolveSourceBytes(firstSource)
  const meta = await sharp(bytes).metadata()
  let cellWidth = Math.max(64, meta.width ?? 64)
  let cellHeight = Math.max(64, meta.height ?? 64)
  const gap = Math.max(0, Math.floor(payload.cellGap))
  const padding = Math.max(0, Math.floor(payload.outerPadding))
  let noteHeight = payload.showFrameNote && payload.notePlacement === 'bottom' ? Math.max(0, Math.floor(payload.noteHeight)) : 0
  let fontSize = Math.max(10, Math.floor(payload.fontSize))
  let canvasWidth = padding * 2 + cols * cellWidth + (cols - 1) * gap
  let canvasHeight = padding * 2 + rows * (cellHeight + noteHeight) + (rows - 1) * gap
  const maxDimension = Math.max(256, Math.floor(payload.maxDimension || 4096))
  const maxEdge = Math.max(canvasWidth, canvasHeight)
  if (maxEdge > maxDimension) {
    const scale = maxDimension / maxEdge
    cellWidth = Math.max(32, Math.round(cellWidth * scale))
    cellHeight = Math.max(32, Math.round(cellHeight * scale))
    noteHeight = Math.max(0, Math.round(noteHeight * scale))
    fontSize = Math.max(10, Math.round(fontSize * scale))
    canvasWidth = padding * 2 + cols * cellWidth + (cols - 1) * gap
    canvasHeight = padding * 2 + rows * (cellHeight + noteHeight) + (rows - 1) * gap
  }
  return { rows, cols, frameCount, cellWidth, cellHeight, gap, padding, noteHeight, fontSize, canvasWidth, canvasHeight }
}

async function buildFrameComposites(payload: MergeStoryboardImagesPayloadDto, layout: MergeLayout): Promise<OverlayOptions[]> {
  const overlays: OverlayOptions[] = []
  for (let index = 0; index < layout.frameCount; index += 1) {
    const source = payload.frameSources[index]?.trim()
    const left = layout.padding + (index % layout.cols) * (layout.cellWidth + layout.gap)
    const top = layout.padding + Math.floor(index / layout.cols) * (layout.cellHeight + layout.noteHeight + layout.gap)
    if (!source) continue
    try {
      const { bytes } = await resolveSourceBytes(source)
      const input = await sharp(bytes)
        .resize(layout.cellWidth, layout.cellHeight, {
          fit: payload.imageFit === 'contain' ? 'contain' : 'cover',
          background: payload.backgroundColor || DEFAULT_BACKGROUND_COLOR,
        })
        .png()
        .toBuffer()
      overlays.push({ input, left, top })
    } catch {
      // Keep placeholder background for failed frames.
    }
  }
  return overlays
}

function buildTextOverlaySvg(payload: MergeStoryboardImagesPayloadDto, layout: MergeLayout): OverlayOptions[] {
  if (!payload.showFrameIndex && !payload.showFrameNote) return []
  const textColor = escapeXml(payload.textColor || DEFAULT_TEXT_COLOR)
  const prefix = escapeXml(payload.frameIndexPrefix?.trim() || 'S')
  const notes = payload.frameNotes ?? []
  const chunks: string[] = []
  for (let index = 0; index < layout.frameCount; index += 1) {
    const x = layout.padding + (index % layout.cols) * (layout.cellWidth + layout.gap)
    const y = layout.padding + Math.floor(index / layout.cols) * (layout.cellHeight + layout.noteHeight + layout.gap)
    if (payload.showFrameIndex) {
      const label = `${prefix}${index + 1}`
      const badgeHeight = Math.max(18, Math.round(layout.fontSize * 1.15))
      const badgeWidth = Math.round(label.length * layout.fontSize * 0.62 + Math.max(6, layout.fontSize * 0.35) * 2)
      chunks.push(`<rect x="${x + 6}" y="${y + 6}" width="${badgeWidth}" height="${badgeHeight}" fill="rgba(0,0,0,0.65)"/>`)
      chunks.push(`<text x="${x + 12}" y="${y + 6 + badgeHeight * 0.72}" fill="${textColor}" font-family="Arial, sans-serif" font-size="${layout.fontSize}" font-weight="600">${label}</text>`)
    }
    if (payload.showFrameNote) {
      const note = escapeXml((notes[index] ?? '').trim())
      if (!note) continue
      if (payload.notePlacement === 'bottom' && layout.noteHeight > 0) {
        chunks.push(`<text x="${x + 4}" y="${y + layout.cellHeight + layout.noteHeight * 0.62}" fill="${textColor}" font-family="Arial, sans-serif" font-size="${layout.fontSize}" font-weight="600">${note}</text>`)
      } else {
        const overlayHeight = Math.max(18, Math.round(layout.fontSize * 1.35))
        const overlayY = y + layout.cellHeight - overlayHeight
        chunks.push(`<rect x="${x}" y="${overlayY}" width="${layout.cellWidth}" height="${overlayHeight}" fill="rgba(0,0,0,0.6)"/>`)
        chunks.push(`<text x="${x + 7}" y="${overlayY + overlayHeight * 0.72}" fill="${textColor}" font-family="Arial, sans-serif" font-size="${layout.fontSize}" font-weight="600">${note}</text>`)
      }
    }
  }
  const svg = `<svg width="${layout.canvasWidth}" height="${layout.canvasHeight}" xmlns="http://www.w3.org/2000/svg">${chunks.join('')}</svg>`
  return [{ input: Buffer.from(svg), left: 0, top: 0 }]
}

function buildStoryboardMetadata(payload: MergeStoryboardImagesPayloadDto, frameCount: number): StoryboardImageMetadataDto {
  const frameNotes = [...(payload.frameNotes ?? [])]
  if (frameNotes.length < frameCount) frameNotes.push(...Array.from({ length: frameCount - frameNotes.length }, () => ''))
  return {
    gridRows: Math.max(1, Math.floor(payload.rows)),
    gridCols: Math.max(1, Math.floor(payload.cols)),
    frameNotes: frameNotes.slice(0, frameCount),
  }
}

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (char) => {
    if (char === '<') return '&lt;'
    if (char === '>') return '&gt;'
    if (char === '&') return '&amp;'
    if (char === '"') return '&quot;'
    return '&apos;'
  })
}
