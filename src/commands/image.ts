import { getPlatform } from '@/platform/runtime'
import type {
  ComposeLocalRedrawResult,
  LocalRedrawContext,
  LocalRedrawSettings,
  PrepareLocalRedrawResult,
} from '@/platform/contracts/image'
import {
  extensionToMime,
  imageCmdInfo,
  isNativeImageRuntime,
  loadImageElement,
  parseAspectRatio,
  persistBytes,
  reduceAspectRatio,
  sourceKindForLog,
  sourceToDataUrl,
  splitSize,
  throwNativeImageFailure,
} from './imageCommandShared'
import { persistImageSource } from './imagePersistenceCommands'
import type {
  CropImageSourcePayload,
  ImageInfoResult,
  PrepareNodeImageSourceResult,
} from './imageCommandTypes'

export type {
  ComposeLocalRedrawResult,
  LocalRedrawContext,
  LocalRedrawSettings,
  PanoramaImageMetadata,
  PanoramaMetadataEmbedResult,
  PanoramaMetadataReadResult,
  PersistImageSourceTrackedResult,
} from '@/platform/contracts/image'
export type {
  CropImageSourcePayload,
  ImageInfoResult,
  MergeStoryboardImagesPayload,
  MergeStoryboardImagesResult,
  PrepareNodeImageSourceResult,
  StoryboardImageMetadata,
} from './imageCommandTypes'
export {
  embedPanoramaImageMetadata,
  embedStoryboardImageMetadata,
  mergeStoryboardImages,
  readPanoramaImageMetadata,
  readStoryboardImageMetadata,
} from './imageStoryboardCommands'
export {
  copyImageSourceToClipboard,
  loadImage,
  persistImageBinary,
  persistImageSource,
  persistImageSourceTracked,
  saveImageSourceToAppDebugDir,
  saveImageSourceToDirectory,
  saveImageSourceToDownloads,
  saveImageSourceToPath,
  savePanoramaImageSourceToDirectory,
  savePanoramaImageSourceToPath,
} from './imagePersistenceCommands'

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


export async function readImageInfo(source: string): Promise<ImageInfoResult> {
  return await getPlatform().image.readImageInfo(source);
}

export async function prepareLocalRedraw(input: {
  source: string
  mask: string
  settings: LocalRedrawSettings
  preferredAspectRatios?: number[]
}): Promise<PrepareLocalRedrawResult> {
  return await getPlatform().image.prepareLocalRedraw(input)
}

export async function composeLocalRedraw(input: {
  generatedSource: string
  context: LocalRedrawContext
}): Promise<ComposeLocalRedrawResult> {
  return await getPlatform().image.composeLocalRedraw(input)
}
