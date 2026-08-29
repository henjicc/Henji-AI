import { createLogger } from '@/core/logging'
import { getPlatform, isDesktopRuntime } from '@/platform/runtime';
import type {
  PanoramaMetadataEmbedResult,
  PanoramaMetadataReadResult,
} from '@/platform/contracts/image';
export type {
  PanoramaImageMetadata,
  PanoramaMetadataEmbedResult,
  PanoramaMetadataReadResult,
} from '@/platform/contracts/image';
import {
  appLocalDataDir,
  dirname,
  downloadDir,
  join,
  mkdir,
  readFile,
  toDisplaySrc,
  writeFile,
} from '@/platform/desktopApi';

const logger = createLogger('commands.image')

import {
  fileToDataUrl,
  inferMimeFromPath,
  saveBase64ToUploads,
  saveBytesToUploads,
} from '@/utils/save';
import { CANVAS_BG_HEX, CANVAS_TEXT_HEX } from '@/core/theme/colorTokens';

const FILE_URL_PREFIX = 'file://';
const LOCAL_PATH_PATTERN = /^(?:[A-Za-z]:[\\/]|\\\\|\/)/;
const storyboardMetadataStore = new Map<string, StoryboardImageMetadata>();
const panoramaMetadataStore = new Map<string, PanoramaMetadataReadResult>();
const IMAGE_CMD_LOG_PREFIX = '[ImageCmd]';
const IMAGE_CMD_LOG_ENABLED = false;

function isNativeImageRuntime(): boolean {
  return isDesktopRuntime();
}

function imageCmdInfo(message: string, payload: DynamicValue): void {
  if (!IMAGE_CMD_LOG_ENABLED) return;
  logger.info(`${IMAGE_CMD_LOG_PREFIX} ${message}`, payload);
}

function imageCmdWarn(message: string, payload: DynamicValue): void {
  if (!IMAGE_CMD_LOG_ENABLED) return;
  logger.warn(`${IMAGE_CMD_LOG_PREFIX} ${message}`, payload);
}

function normalizeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function throwNativeImageFailure(
  operation: string,
  startedAt: number,
  error: unknown,
  context: DynamicValueMap = {}
): never {
  imageCmdWarn(`${operation} native-failed`, {
    runtime: 'desktop',
    totalMs: Math.round(performance.now() - startedAt),
    error: normalizeErrorMessage(error),
    ...context,
  });
  throw error instanceof Error
    ? error
    : new Error(`${operation} failed: ${String(error)}`);
}

function sourceKindForLog(source: string): 'data-url' | 'http' | 'blob' | 'local-path' | 'other' {
  if (isDataUrl(source)) return 'data-url';
  if (isHttpUrl(source)) return 'http';
  if (isBlobUrl(source)) return 'blob';
  if (isLikelyLocalPath(source)) return 'local-path';
  return 'other';
}

function normalizeSourceKey(source: string): string {
  return source.trim();
}

function isDataUrl(source: string): boolean {
  return source.startsWith('data:');
}

function isHttpUrl(source: string): boolean {
  return source.startsWith('http://') || source.startsWith('https://');
}

function isBlobUrl(source: string): boolean {
  return source.startsWith('blob:');
}

function isLikelyLocalPath(source: string): boolean {
  if (!source) return false;
  if (source.startsWith('asset:') || source.startsWith('tauri:')) return false;
  if (isDataUrl(source) || isHttpUrl(source) || isBlobUrl(source)) return false;
  if (source.startsWith(FILE_URL_PREFIX)) return true;
  return LOCAL_PATH_PATTERN.test(source);
}

function decodeFileUrl(source: string): string {
  if (!source.startsWith(FILE_URL_PREFIX)) {
    return source;
  }

  try {
    const url = new URL(source);
    const decoded = decodeURIComponent(url.pathname);
    return decoded.replace(/^\/([A-Za-z]:[\\/])/, '$1');
  } catch {
    return source;
  }
}

function normalizeLocalPath(source: string): string {
  return decodeFileUrl(source.trim());
}

function extensionToMime(extension: string): string {
  const normalized = extension.replace(/^\./, '').toLowerCase();
  if (normalized === 'jpg' || normalized === 'jpeg') return 'image/jpeg';
  if (normalized === 'webp') return 'image/webp';
  if (normalized === 'gif') return 'image/gif';
  if (normalized === 'bmp') return 'image/bmp';
  if (normalized === 'avif') return 'image/avif';
  return 'image/png';
}

function mimeToExtension(mime: string): string {
  const normalized = mime.toLowerCase();
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg';
  if (normalized.includes('webp')) return 'webp';
  if (normalized.includes('gif')) return 'gif';
  if (normalized.includes('bmp')) return 'bmp';
  if (normalized.includes('avif')) return 'avif';
  return 'png';
}

function parseDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } {
  const match = dataUrl.match(/^data:([\w/+.-]+);base64,(.+)$/);
  if (!match) {
    throw new Error('Invalid data URL');
  }
  const [, mime, payload] = match;
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return { mime, bytes };
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const reader = new FileReader();
  return await new Promise((resolve, reject) => {
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Blob to DataURL failed'));
    reader.readAsDataURL(blob);
  });
}

function resolveDisplaySource(source: string): string {
  if (isLikelyLocalPath(source)) {
    return toDisplaySrc(normalizeLocalPath(source));
  }
  return source;
}

async function loadImageElement(source: string): Promise<HTMLImageElement> {
  const image = new Image();
  const displaySource = resolveDisplaySource(source);
  if (isHttpUrl(displaySource)) {
    image.crossOrigin = 'anonymous';
  }

  return await new Promise((resolve, reject) => {
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片加载失败'));
    image.src = displaySource;
  });
}

function reduceAspectRatio(width: number, height: number): string {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));

  let a = safeWidth;
  let b = safeHeight;
  while (b !== 0) {
    const t = b;
    b = a % b;
    a = t;
  }

  const gcd = a || 1;
  return `${Math.round(safeWidth / gcd)}:${Math.round(safeHeight / gcd)}`;
}

function parseAspectRatio(value: string): number {
  const [wRaw = '1', hRaw = '1'] = value.split(':');
  const w = Number(wRaw);
  const h = Number(hRaw);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return 1;
  }
  return w / h;
}

async function sourceToDataUrl(source: string): Promise<string> {
  if (isDataUrl(source)) {
    return source;
  }

  if (isLikelyLocalPath(source)) {
    return await fileToDataUrl(normalizeLocalPath(source));
  }

  const response = await fetch(resolveDisplaySource(source));
  if (!response.ok) {
    throw new Error(`读取图片失败: ${response.status}`);
  }

  const blob = await response.blob();
  return await blobToDataUrl(blob);
}

async function sourceToBytes(source: string): Promise<{ bytes: Uint8Array; mime: string }> {
  if (isDataUrl(source)) {
    return parseDataUrl(source);
  }

  if (isLikelyLocalPath(source)) {
    const path = normalizeLocalPath(source);
    const bytes = await readFile(path);
    return {
      bytes,
      mime: inferMimeFromPath(path),
    };
  }

  const response = await fetch(resolveDisplaySource(source));
  if (!response.ok) {
    throw new Error(`下载图片失败: ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  const mime = response.headers.get('content-type') || 'image/png';
  return {
    bytes: new Uint8Array(buffer),
    mime,
  };
}

async function ensurePathWritable(targetPath: string): Promise<void> {
  const targetDir = await dirname(targetPath);
  await mkdir(targetDir, { recursive: true });
}

function resolveSafeFilename(input: string): string {
  const fallback = `image-${Date.now()}`;
  const trimmed = input.trim();
  if (!trimmed) return fallback;
  // eslint-disable-next-line no-control-regex
  return trimmed.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
}

function splitSize(totalSize: number, count: number): number[] {
  const base = Math.floor(totalSize / count);
  const remainder = totalSize % count;
  return Array.from({ length: count }, (_unused, index) => base + (index < remainder ? 1 : 0));
}

function drawImageWithFit(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  fit: 'cover' | 'contain'
): void {
  const imageRatio = image.naturalWidth / Math.max(1, image.naturalHeight);
  const targetRatio = dw / Math.max(1, dh);

  if (fit === 'cover') {
    if (imageRatio > targetRatio) {
      const sw = image.naturalHeight * targetRatio;
      const sx = (image.naturalWidth - sw) / 2;
      context.drawImage(image, sx, 0, sw, image.naturalHeight, dx, dy, dw, dh);
      return;
    }

    const sh = image.naturalWidth / targetRatio;
    const sy = (image.naturalHeight - sh) / 2;
    context.drawImage(image, 0, sy, image.naturalWidth, sh, dx, dy, dw, dh);
    return;
  }

  const scale = Math.min(dw / image.naturalWidth, dh / image.naturalHeight);
  const tw = Math.max(1, Math.round(image.naturalWidth * scale));
  const th = Math.max(1, Math.round(image.naturalHeight * scale));
  const tx = dx + (dw - tw) / 2;
  const ty = dy + (dh - th) / 2;
  context.drawImage(image, tx, ty, tw, th);
}

function trimTextToWidth(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string {
  const clean = text.trim();
  if (!clean) return '';
  if (context.measureText(clean).width <= maxWidth) return clean;

  let value = clean;
  while (value.length > 1) {
    value = value.slice(0, -1);
    const next = `${value}...`;
    if (context.measureText(next).width <= maxWidth) {
      return next;
    }
  }

  return '...';
}

async function persistDataUrl(source: string): Promise<string> {
  const saved = await saveBase64ToUploads(source);
  return saved.fullPath;
}

async function persistBytes(bytes: Uint8Array, mime: string): Promise<string> {
  const saved = await saveBytesToUploads(bytes, mime);
  return saved.fullPath;
}

async function localSplitImage(
  source: string,
  rows: number,
  cols: number,
  lineThickness: number
): Promise<string[]> {
  const image = await loadImageElement(source);
  const safeRows = Math.max(1, Math.floor(rows));
  const safeCols = Math.max(1, Math.floor(cols));
  const safeLine = Math.max(0, Math.floor(lineThickness));

  const maxLineByWidth = safeCols > 1
    ? Math.floor((image.naturalWidth - safeCols) / (safeCols - 1))
    : Number.MAX_SAFE_INTEGER;
  const maxLineByHeight = safeRows > 1
    ? Math.floor((image.naturalHeight - safeRows) / (safeRows - 1))
    : Number.MAX_SAFE_INTEGER;
  const resolvedLine = Math.max(0, Math.min(safeLine, maxLineByWidth, maxLineByHeight));

  const usableWidth = image.naturalWidth - (safeCols - 1) * resolvedLine;
  const usableHeight = image.naturalHeight - (safeRows - 1) * resolvedLine;
  if (usableWidth < safeCols || usableHeight < safeRows) {
    throw new Error('分割线过粗，无法切割');
  }

  const colSizes = splitSize(usableWidth, safeCols);
  const rowSizes = splitSize(usableHeight, safeRows);

  const xOffsets: number[] = [];
  let x = 0;
  for (let col = 0; col < safeCols; col += 1) {
    xOffsets.push(x);
    x += colSizes[col] + (col < safeCols - 1 ? resolvedLine : 0);
  }

  const yOffsets: number[] = [];
  let y = 0;
  for (let row = 0; row < safeRows; row += 1) {
    yOffsets.push(y);
    y += rowSizes[row] + (row < safeRows - 1 ? resolvedLine : 0);
  }

  const outputs: string[] = [];
  for (let row = 0; row < safeRows; row += 1) {
    for (let col = 0; col < safeCols; col += 1) {
      const canvas = document.createElement('canvas');
      canvas.width = colSizes[col];
      canvas.height = rowSizes[row];
      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('切割画布初始化失败');
      }

      context.drawImage(
        image,
        xOffsets[col],
        yOffsets[row],
        colSizes[col],
        rowSizes[row],
        0,
        0,
        colSizes[col],
        rowSizes[row]
      );
      outputs.push(canvas.toDataURL('image/png'));
    }
  }

  return outputs;
}

export async function splitImage(
  imageBase64: string,
  rows: number,
  cols: number,
  lineThickness = 0
): Promise<string[]> {
  const startedAt = performance.now();
  const runtime = isNativeImageRuntime() ? 'desktop' : 'web';
  imageCmdInfo('splitImage start', {
    runtime,
    rows,
    cols,
    lineThickness,
  });

  if (!isNativeImageRuntime()) {
    const fallback = await localSplitImage(imageBase64, rows, cols, lineThickness);
    imageCmdInfo('splitImage fallback(web)', {
      frames: fallback.length,
      totalMs: Math.round(performance.now() - startedAt),
    });
    return fallback;
  }

  try {
    const rustResult = await getPlatform().image.splitImage(imageBase64, rows, cols, lineThickness);
    imageCmdInfo('splitImage rust', {
      frames: rustResult.length,
      totalMs: Math.round(performance.now() - startedAt),
    });
    return rustResult;
  } catch (error) {
    throwNativeImageFailure('splitImage', startedAt, error, { rows, cols, lineThickness });
  }
}

export async function splitImageSource(
  source: string,
  rows: number,
  cols: number,
  lineThickness = 0
): Promise<string[]> {
  const startedAt = performance.now();
  const runtime = isNativeImageRuntime() ? 'desktop' : 'web';
  imageCmdInfo('splitImageSource start', {
    runtime,
    sourceKind: sourceKindForLog(source),
    rows,
    cols,
    lineThickness,
  });

  if (!isNativeImageRuntime()) {
    const fallback = await localSplitImage(source, rows, cols, lineThickness);
    imageCmdInfo('splitImageSource fallback(web)', {
      frames: fallback.length,
      totalMs: Math.round(performance.now() - startedAt),
    });
    return fallback;
  }

  try {
    const rustResult = await getPlatform().image.splitImageSource(source, rows, cols, lineThickness);
    imageCmdInfo('splitImageSource rust', {
      frames: rustResult.length,
      totalMs: Math.round(performance.now() - startedAt),
    });
    return rustResult;
  } catch (error) {
    throwNativeImageFailure('splitImageSource', startedAt, error, {
      sourceKind: sourceKindForLog(source),
      rows,
      cols,
      lineThickness,
    });
  }
}

export interface MergeStoryboardImagesPayload {
  frameSources: string[];
  rows: number;
  cols: number;
  cellGap: number;
  outerPadding: number;
  noteHeight: number;
  fontSize: number;
  backgroundColor: string;
  maxDimension: number;
  showFrameIndex?: boolean;
  showFrameNote?: boolean;
  notePlacement?: 'overlay' | 'bottom';
  imageFit?: 'cover' | 'contain';
  frameIndexPrefix?: string;
  textColor?: string;
  frameNotes?: string[];
}

export interface StoryboardImageMetadata {
  gridRows: number;
  gridCols: number;
  frameNotes: string[];
}

export interface PrepareNodeImageSourceResult {
  imagePath: string;
  previewImagePath: string;
  aspectRatio: string;
  createdFilePaths: string[];
}

export interface CropImageSourcePayload {
  source: string;
  aspectRatio?: string;
  cropX?: number;
  cropY?: number;
  cropWidth?: number;
  cropHeight?: number;
}

export interface MergeStoryboardImagesResult {
  imagePath: string;
  canvasWidth: number;
  canvasHeight: number;
  cellWidth: number;
  cellHeight: number;
  gap: number;
  padding: number;
  noteHeight: number;
  fontSize: number;
  textOverlayApplied: boolean;
  metadataEmbedded?: boolean;
}

export async function mergeStoryboardImages(
  payload: MergeStoryboardImagesPayload
): Promise<MergeStoryboardImagesResult> {
  const startedAt = performance.now();
  if (isNativeImageRuntime()) {
    try {
      return await getPlatform().image.mergeStoryboardImages(payload);
    } catch (error) {
      throwNativeImageFailure('mergeStoryboardImages', startedAt, error, {
        frames: payload.frameSources.length,
        rows: payload.rows,
        cols: payload.cols,
      });
    }
  }

  const rows = Math.max(1, Math.floor(payload.rows));
  const cols = Math.max(1, Math.floor(payload.cols));
  const frameCount = Math.max(1, rows * cols);
  const frameSources = payload.frameSources.slice(0, frameCount);

  const firstSource = frameSources.find((source) => source.trim().length > 0);
  if (!firstSource) {
    throw new Error('没有可合并的分镜图片');
  }

  const firstImage = await loadImageElement(firstSource);
  let cellWidth = Math.max(64, firstImage.naturalWidth);
  let cellHeight = Math.max(64, firstImage.naturalHeight);

  const gap = Math.max(0, Math.floor(payload.cellGap));
  const padding = Math.max(0, Math.floor(payload.outerPadding));
  const showFrameNote = Boolean(payload.showFrameNote);
  const showFrameIndex = Boolean(payload.showFrameIndex);
  const notePlacement = payload.notePlacement === 'bottom' ? 'bottom' : 'overlay';
  const noteHeight = showFrameNote && notePlacement === 'bottom'
    ? Math.max(0, Math.floor(payload.noteHeight))
    : 0;
  const fontSize = Math.max(10, Math.floor(payload.fontSize));

  let canvasWidth = padding * 2 + cols * cellWidth + (cols - 1) * gap;
  let canvasHeight = padding * 2 + rows * (cellHeight + noteHeight) + (rows - 1) * gap;

  const maxDimension = Math.max(256, Math.floor(payload.maxDimension || 4096));
  const maxEdge = Math.max(canvasWidth, canvasHeight);
  if (maxEdge > maxDimension) {
    const scale = maxDimension / maxEdge;
    cellWidth = Math.max(32, Math.floor(cellWidth * scale));
    cellHeight = Math.max(32, Math.floor(cellHeight * scale));
    canvasWidth = padding * 2 + cols * cellWidth + (cols - 1) * gap;
    canvasHeight = padding * 2 + rows * (cellHeight + noteHeight) + (rows - 1) * gap;
  }

  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('合并画布初始化失败');
  }

  context.fillStyle = payload.backgroundColor || CANVAS_BG_HEX;
  context.fillRect(0, 0, canvasWidth, canvasHeight);

  const fit = payload.imageFit === 'contain' ? 'contain' : 'cover';
  const frameNotes = payload.frameNotes ?? [];
  const textColor = payload.textColor || CANVAS_TEXT_HEX;
  const prefix = payload.frameIndexPrefix || 'S';

  context.textBaseline = 'middle';
  context.textAlign = 'left';
  context.font = `600 ${fontSize}px sans-serif`;

  for (let index = 0; index < frameCount; index += 1) {
    const row = Math.floor(index / cols);
    const col = index % cols;
    const x = padding + col * (cellWidth + gap);
    const y = padding + row * (cellHeight + noteHeight + gap);

    const source = frameSources[index] || '';
    if (source) {
      try {
        const image = await loadImageElement(source);
        drawImageWithFit(context, image, x, y, cellWidth, cellHeight, fit);
      } catch {
        context.fillStyle = 'rgba(255,255,255,0.08)';
        context.fillRect(x, y, cellWidth, cellHeight);
      }
    } else {
      context.fillStyle = 'rgba(255,255,255,0.08)';
      context.fillRect(x, y, cellWidth, cellHeight);
    }

    if (!showFrameIndex && !showFrameNote) {
      continue;
    }

    const label = `${prefix}${index + 1}`;
    const note = frameNotes[index] ?? '';

    if (showFrameIndex) {
      const badgePaddingX = Math.max(6, Math.round(fontSize * 0.35));
      const badgeHeight = Math.max(18, Math.round(fontSize * 1.15));
      const textWidth = context.measureText(label).width;
      const badgeWidth = Math.round(textWidth + badgePaddingX * 2);
      context.fillStyle = 'rgba(0,0,0,0.65)';
      context.fillRect(x + 6, y + 6, badgeWidth, badgeHeight);
      context.fillStyle = textColor;
      context.fillText(label, x + 6 + badgePaddingX, y + 6 + badgeHeight / 2);
    }

    if (showFrameNote) {
      const safeText = trimTextToWidth(context, note, Math.max(20, cellWidth - 12));
      if (!safeText) continue;

      if (notePlacement === 'overlay') {
        const overlayHeight = Math.max(18, Math.round(fontSize * 1.35));
        const overlayY = y + cellHeight - overlayHeight;
        context.fillStyle = 'rgba(0,0,0,0.6)';
        context.fillRect(x, overlayY, cellWidth, overlayHeight);
        context.fillStyle = textColor;
        context.fillText(safeText, x + 6, overlayY + overlayHeight / 2);
      } else if (noteHeight > 0) {
        context.fillStyle = textColor;
        context.fillText(safeText, x + 4, y + cellHeight + noteHeight / 2);
      }
    }
  }

  const dataUrl = canvas.toDataURL('image/png');
  const imagePath = await persistDataUrl(dataUrl);

  return {
    imagePath,
    canvasWidth,
    canvasHeight,
    cellWidth,
    cellHeight,
    gap,
    padding,
    noteHeight,
    fontSize,
    textOverlayApplied: showFrameIndex || showFrameNote,
    metadataEmbedded: false,
  };
}

export async function readStoryboardImageMetadata(
  source: string
): Promise<StoryboardImageMetadata | null> {
  const startedAt = performance.now();
  if (isNativeImageRuntime()) {
    try {
      return await getPlatform().image.readStoryboardImageMetadata(source);
    } catch (error) {
      throwNativeImageFailure('readStoryboardImageMetadata', startedAt, error, {
        sourceKind: sourceKindForLog(source),
      });
    }
  }
  return storyboardMetadataStore.get(normalizeSourceKey(source)) ?? null;
}

export async function embedStoryboardImageMetadata(
  source: string,
  metadata: StoryboardImageMetadata
): Promise<string> {
  const startedAt = performance.now();
  if (isNativeImageRuntime()) {
    try {
      return await getPlatform().image.embedStoryboardImageMetadata(source, metadata);
    } catch (error) {
      throwNativeImageFailure('embedStoryboardImageMetadata', startedAt, error, {
        sourceKind: sourceKindForLog(source),
      });
    }
  }
  storyboardMetadataStore.set(normalizeSourceKey(source), {
    gridRows: Math.max(1, Math.floor(metadata.gridRows)),
    gridCols: Math.max(1, Math.floor(metadata.gridCols)),
    frameNotes: Array.isArray(metadata.frameNotes) ? metadata.frameNotes : [],
  });
  return source;
}

export async function readPanoramaImageMetadata(
  source: string
): Promise<PanoramaMetadataReadResult> {
  const startedAt = performance.now();
  if (isNativeImageRuntime()) {
    try {
      return await getPlatform().image.readPanoramaImageMetadata(source);
    } catch (error) {
      throwNativeImageFailure('readPanoramaImageMetadata', startedAt, error, {
        sourceKind: sourceKindForLog(source),
      });
    }
  }
  return panoramaMetadataStore.get(normalizeSourceKey(source)) ?? {
    format: 'unsupported',
    status: 'unsupported',
    metadata: null,
  };
}

export async function embedPanoramaImageMetadata(
  source: string
): Promise<PanoramaMetadataEmbedResult> {
  const startedAt = performance.now();
  if (isNativeImageRuntime()) {
    try {
      return await getPlatform().image.embedPanoramaImageMetadata(source);
    } catch (error) {
      throwNativeImageFailure('embedPanoramaImageMetadata', startedAt, error, {
        sourceKind: sourceKindForLog(source),
      });
    }
  }
  const image = await loadImageElement(source);
  if (image.naturalWidth !== image.naturalHeight * 2) {
    throw new Error(`Panorama image must use an exact 2:1 ratio, received ${image.naturalWidth}×${image.naturalHeight}`);
  }
  const metadata = {
    projectionType: 'equirectangular' as const,
    usePanoramaViewer: true as const,
    fullPanoWidthPixels: image.naturalWidth,
    fullPanoHeightPixels: image.naturalHeight,
    croppedAreaImageWidthPixels: image.naturalWidth,
    croppedAreaImageHeightPixels: image.naturalHeight,
    croppedAreaLeftPixels: 0,
    croppedAreaTopPixels: 0,
  };
  const result = { imagePath: source, format: 'png' as const, metadata };
  panoramaMetadataStore.set(normalizeSourceKey(source), {
    format: result.format,
    status: 'valid',
    metadata,
  });
  return result;
}

function renderPreviewDataUrl(
  image: HTMLImageElement,
  sourceDataUrl: string,
  maxDimension: number
): string {
  const longestSide = Math.max(image.naturalWidth, image.naturalHeight);
  if (longestSide <= maxDimension) {
    return sourceDataUrl;
  }

  const scale = maxDimension / longestSide;
  const targetWidth = Math.max(1, Math.round(image.naturalWidth * scale));
  const targetHeight = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const context = canvas.getContext('2d');
  if (!context) {
    return sourceDataUrl;
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, targetWidth, targetHeight);
  return canvas.toDataURL('image/jpeg', 0.86);
}

export async function prepareNodeImageSource(
  source: string,
  maxPreviewDimension = 512
): Promise<PrepareNodeImageSourceResult> {
  const startedAt = performance.now();
  if (isNativeImageRuntime()) {
    try {
      return await getPlatform().image.prepareNodeImageSource(source, maxPreviewDimension);
    } catch (error) {
      throwNativeImageFailure('prepareNodeImageSource', startedAt, error, {
        sourceKind: sourceKindForLog(source),
        maxPreviewDimension,
      });
    }
  }

  const imagePath = await persistImageSource(source);
  const dataUrl = await sourceToDataUrl(imagePath);
  const image = await loadImageElement(dataUrl);
  const aspectRatio = reduceAspectRatio(image.naturalWidth, image.naturalHeight);

  const safeMax = Math.max(64, Math.floor(maxPreviewDimension));
  const previewDataUrl = renderPreviewDataUrl(image, dataUrl, safeMax);
  const previewImagePath = previewDataUrl === dataUrl
    ? imagePath
    : await persistImageSource(previewDataUrl);

  return {
    imagePath,
    previewImagePath,
    aspectRatio,
    createdFilePaths: [],
  };
}

export async function prepareNodeImageBinary(
  bytes: Uint8Array,
  extension?: string,
  maxPreviewDimension = 512
): Promise<PrepareNodeImageSourceResult> {
  const startedAt = performance.now();
  if (isNativeImageRuntime()) {
    try {
      return await getPlatform().image.prepareNodeImageBinary(bytes, extension, maxPreviewDimension);
    } catch (error) {
      throwNativeImageFailure('prepareNodeImageBinary', startedAt, error, {
        byteLength: bytes.byteLength,
        extension,
        maxPreviewDimension,
      });
    }
  }

  const mime = extensionToMime(extension || 'png');
  const imagePath = await persistBytes(bytes, mime);
  return await prepareNodeImageSource(imagePath, maxPreviewDimension);
}

export async function cropImageSource(
  payload: CropImageSourcePayload
): Promise<string> {
  const startedAt = performance.now();
  if (isNativeImageRuntime()) {
    try {
      return await getPlatform().image.cropImageSource(payload);
    } catch (error) {
      throwNativeImageFailure('cropImageSource', startedAt, error, {
        sourceKind: sourceKindForLog(payload.source),
        aspectRatio: payload.aspectRatio,
      });
    }
  }

  const image = await loadImageElement(payload.source);

  const cropX = Number(payload.cropX);
  const cropY = Number(payload.cropY);
  const cropWidth = Number(payload.cropWidth);
  const cropHeight = Number(payload.cropHeight);

  let sx = 0;
  let sy = 0;
  let sw = image.naturalWidth;
  let sh = image.naturalHeight;

  const hasExplicitCrop =
    Number.isFinite(cropX)
    && Number.isFinite(cropY)
    && Number.isFinite(cropWidth)
    && Number.isFinite(cropHeight)
    && cropWidth > 0
    && cropHeight > 0;

  if (hasExplicitCrop) {
    sx = Math.max(0, Math.floor(cropX));
    sy = Math.max(0, Math.floor(cropY));
    sw = Math.min(image.naturalWidth - sx, Math.floor(cropWidth));
    sh = Math.min(image.naturalHeight - sy, Math.floor(cropHeight));
  } else if (payload.aspectRatio && payload.aspectRatio !== 'free') {
    const targetRatio = parseAspectRatio(payload.aspectRatio);
    const sourceRatio = image.naturalWidth / Math.max(1, image.naturalHeight);
    if (sourceRatio > targetRatio) {
      sw = Math.max(1, Math.floor(image.naturalHeight * targetRatio));
      sx = Math.floor((image.naturalWidth - sw) / 2);
    } else {
      sh = Math.max(1, Math.floor(image.naturalWidth / targetRatio));
      sy = Math.floor((image.naturalHeight - sh) / 2);
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, sw);
  canvas.height = Math.max(1, sh);
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('裁剪画布初始化失败');
  }

  context.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

export interface ImageInfoResult {
  source: string;
  fileName: string | null;
  extension: string;
  width: number;
  height: number;
  orientation: number | null;
  hasAlpha: boolean;
  fileSizeBytes: number;
  createdAt: number | null;
  modifiedAt: number | null;
}

export async function readImageInfo(source: string): Promise<ImageInfoResult> {
  return await getPlatform().image.readImageInfo(source);
}

export async function loadImage(filePath: string): Promise<string> {
  const startedAt = performance.now();
  if (isNativeImageRuntime()) {
    try {
      return await getPlatform().image.loadImage(filePath);
    } catch (error) {
      throwNativeImageFailure('loadImage', startedAt, error, {
        sourceKind: sourceKindForLog(filePath),
      });
    }
  }
  return await fileToDataUrl(normalizeLocalPath(filePath));
}

export async function persistImageSource(source: string): Promise<string> {
  const startedAt = performance.now();
  if (isNativeImageRuntime()) {
    try {
      return await getPlatform().image.persistImageSource(source);
    } catch (error) {
      throwNativeImageFailure('persistImageSource', startedAt, error, {
        sourceKind: sourceKindForLog(source),
      });
    }
  }

  if (isLikelyLocalPath(source)) {
    return normalizeLocalPath(source);
  }

  if (isDataUrl(source)) {
    return await persistDataUrl(source);
  }

  const { bytes, mime } = await sourceToBytes(source);
  return await persistBytes(bytes, mime);
}

export async function persistImageBinary(
  bytes: Uint8Array,
  extension = 'png'
): Promise<string> {
  const startedAt = performance.now();
  if (isNativeImageRuntime()) {
    try {
      return await getPlatform().image.persistImageBinary(bytes, extension);
    } catch (error) {
      throwNativeImageFailure('persistImageBinary', startedAt, error, {
        byteLength: bytes.byteLength,
        extension,
      });
    }
  }
  return await persistBytes(bytes, extensionToMime(extension));
}

export async function saveImageSourceToDownloads(
  source: string,
  suggestedFileName?: string
): Promise<string> {
  const startedAt = performance.now();
  if (isNativeImageRuntime()) {
    try {
      return await getPlatform().image.saveImageSourceToDownloads(source, suggestedFileName);
    } catch (error) {
      throwNativeImageFailure('saveImageSourceToDownloads', startedAt, error, {
        sourceKind: sourceKindForLog(source),
        suggestedFileName,
      });
    }
  }

  try {
    const dir = await downloadDir();
    return await saveImageSourceToDirectory(source, dir, suggestedFileName);
  } catch {
    const appDir = await appLocalDataDir();
    const fallbackDir = await join(appDir, 'Henji-AI', 'Downloads');
    return await saveImageSourceToDirectory(source, fallbackDir, suggestedFileName);
  }
}

export async function saveImageSourceToPath(
  source: string,
  targetPath: string
): Promise<string> {
  const startedAt = performance.now();
  if (isNativeImageRuntime()) {
    try {
      return await getPlatform().image.saveImageSourceToPath(source, targetPath);
    } catch (error) {
      throwNativeImageFailure('saveImageSourceToPath', startedAt, error, {
        sourceKind: sourceKindForLog(source),
      });
    }
  }

  const { bytes } = await sourceToBytes(source);
  await ensurePathWritable(targetPath);
  await writeFile(targetPath, bytes);

  const metadata = await readStoryboardImageMetadata(source);
  if (metadata) {
    storyboardMetadataStore.set(normalizeSourceKey(targetPath), metadata);
  }

  return targetPath;
}

export async function savePanoramaImageSourceToPath(
  source: string,
  targetPath: string
): Promise<string> {
  const startedAt = performance.now();
  if (isNativeImageRuntime()) {
    try {
      return await getPlatform().image.savePanoramaImageSourceToPath(source, targetPath);
    } catch (error) {
      throwNativeImageFailure('savePanoramaImageSourceToPath', startedAt, error, {
        sourceKind: sourceKindForLog(source),
      });
    }
  }
  const embedded = await embedPanoramaImageMetadata(source);
  return await saveImageSourceToPath(embedded.imagePath, targetPath);
}

export async function saveImageSourceToDirectory(
  source: string,
  targetDir: string,
  suggestedFileName?: string
): Promise<string> {
  const startedAt = performance.now();
  if (isNativeImageRuntime()) {
    try {
      return await getPlatform().image.saveImageSourceToDirectory(source, targetDir, suggestedFileName);
    } catch (error) {
      throwNativeImageFailure('saveImageSourceToDirectory', startedAt, error, {
        sourceKind: sourceKindForLog(source),
        suggestedFileName,
      });
    }
  }

  const { bytes, mime } = await sourceToBytes(source);
  await mkdir(targetDir, { recursive: true });

  const extension = mimeToExtension(mime);
  const base = resolveSafeFilename((suggestedFileName || `image-${Date.now()}`).replace(/\.[^.]+$/, ''));
  const targetPath = await join(targetDir, `${base}.${extension}`);
  await writeFile(targetPath, bytes);

  const metadata = await readStoryboardImageMetadata(source);
  if (metadata) {
    storyboardMetadataStore.set(normalizeSourceKey(targetPath), metadata);
  }

  return targetPath;
}

export async function savePanoramaImageSourceToDirectory(
  source: string,
  targetDir: string,
  suggestedFileName?: string
): Promise<string> {
  const startedAt = performance.now();
  if (isNativeImageRuntime()) {
    try {
      return await getPlatform().image.savePanoramaImageSourceToDirectory(source, targetDir, suggestedFileName);
    } catch (error) {
      throwNativeImageFailure('savePanoramaImageSourceToDirectory', startedAt, error, {
        sourceKind: sourceKindForLog(source),
        suggestedFileName,
      });
    }
  }
  const embedded = await embedPanoramaImageMetadata(source);
  return await saveImageSourceToDirectory(embedded.imagePath, targetDir, suggestedFileName);
}

export async function saveImageSourceToAppDebugDir(
  source: string,
  category = 'grid',
  suggestedFileName?: string
): Promise<string> {
  const startedAt = performance.now();
  if (isNativeImageRuntime()) {
    try {
      return await getPlatform().image.saveImageSourceToAppDebugDir(source, category, suggestedFileName);
    } catch (error) {
      throwNativeImageFailure('saveImageSourceToAppDebugDir', startedAt, error, {
        sourceKind: sourceKindForLog(source),
        category,
        suggestedFileName,
      });
    }
  }

  const appDir = await appLocalDataDir();
  const debugDir = await join(appDir, 'Henji-AI', 'debug', category || 'grid');
  return await saveImageSourceToDirectory(source, debugDir, suggestedFileName);
}

export async function copyImageSourceToClipboard(source: string): Promise<void> {
  const startedAt = performance.now();
  try {
    await getPlatform().clipboard.writeImageFromSource(source);
    return;
  } catch (error) {
    if (!isNativeImageRuntime()) {
      imageCmdWarn('copyImageSourceToClipboard native-unavailable -> web fallback', {
        runtime: 'web',
        error: normalizeErrorMessage(error),
      });
    }
  }

  const localPath = await persistImageSource(source);

  if (isNativeImageRuntime()) {
    try {
      await getPlatform().clipboard.writeImageFromPath(localPath);
      return;
    } catch (error) {
      throwNativeImageFailure('copyImageSourceToClipboard', startedAt, error, {
        sourceKind: sourceKindForLog(source),
      });
    }
  }

  const dataUrl = await sourceToDataUrl(localPath);
  const blob = await (await fetch(dataUrl)).blob();
  if (!('clipboard' in navigator) || typeof ClipboardItem === 'undefined') {
    throw new Error('当前环境不支持图片复制');
  }
  await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
}
