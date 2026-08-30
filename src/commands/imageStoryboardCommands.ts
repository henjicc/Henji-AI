import { getPlatform } from '@/platform/runtime'
import { CANVAS_BG_HEX, CANVAS_TEXT_HEX } from '@/core/theme/colorTokens'
import type {
  MergeStoryboardImagesPayload,
  MergeStoryboardImagesResult,
  StoryboardImageMetadata,
} from './imageCommandTypes'
import type {
  PanoramaMetadataEmbedResult,
  PanoramaMetadataReadResult,
} from '@/platform/contracts/image'
import {
  drawImageWithFit,
  isNativeImageRuntime,
  loadImageElement,
  normalizeSourceKey,
  panoramaMetadataStore,
  persistDataUrl,
  sourceKindForLog,
  storyboardMetadataStore,
  throwNativeImageFailure,
  trimTextToWidth,
} from './imageCommandShared'

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
