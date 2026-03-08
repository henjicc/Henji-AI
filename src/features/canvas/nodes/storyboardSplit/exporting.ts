import {
  embedStoryboardImageMetadata,
  mergeStoryboardImages,
  type MergeStoryboardImagesResult,
} from '@/commands/image';
import type { StoryboardExportOptions, StoryboardFrameItem } from '@/features/canvas/domain/canvasNodes';
import { EXPORT_RESULT_DISPLAY_NAME } from '@/features/canvas/domain/nodeDisplay';
import {
  canvasToDataUrl,
  loadImageElement,
  persistImageLocally,
  reduceAspectRatio,
} from '@/features/canvas/application/imageData';
import { clamp } from './shared';

const EXPORT_MAX_DIMENSION = 4096;
const EXPORT_TRACE_PREFIX = '[StoryboardExport]';
const EXPORT_TRACE_ENABLED = false;

interface ExportStoryboardImagesParams {
  nodeId: string;
  gridRows: number;
  gridCols: number;
  orderedFrames: StoryboardFrameItem[];
  exportOptions: StoryboardExportOptions;
  createExportNode: (imageUrl: string, aspectRatio: string, previewImageUrl: string) => string | null;
  linkExportNode: (createdNodeId: string) => void;
}

function exportTraceInfo(message: string, payload: unknown): void {
  if (!EXPORT_TRACE_ENABLED) {
    return;
  }
  console.info(`${EXPORT_TRACE_PREFIX} ${message}`, payload);
}

function exportTraceWarn(message: string, payload: unknown): void {
  if (!EXPORT_TRACE_ENABLED) {
    return;
  }
  console.warn(`${EXPORT_TRACE_PREFIX} ${message}`, payload);
}

function trimTextToWidth(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string {
  const safeText = text.trim();
  if (!safeText) {
    return '';
  }

  if (context.measureText(safeText).width <= maxWidth) {
    return safeText;
  }

  let content = safeText;
  while (content.length > 1) {
    content = content.slice(0, -1);
    const withEllipsis = `${content}...`;
    if (context.measureText(withEllipsis).width <= maxWidth) {
      return withEllipsis;
    }
  }

  return '...';
}

async function applyStoryboardTextOverlay(
  imageSource: string,
  frames: StoryboardFrameItem[],
  options: StoryboardExportOptions,
  rows: number,
  cols: number,
  layout: MergeStoryboardImagesResult
): Promise<string> {
  if (!options.showFrameIndex && !options.showFrameNote) {
    return imageSource;
  }

  const image = await loadImageElement(imageSource);
  const canvas = document.createElement('canvas');
  canvas.width = layout.canvasWidth;
  canvas.height = layout.canvasHeight;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('导出画布初始化失败');
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  context.textBaseline = 'middle';
  context.textAlign = 'left';
  context.font = `${Math.max(500, Math.round(layout.fontSize * 1.2))} ${layout.fontSize}px sans-serif`;

  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    const row = Math.floor(index / Math.max(1, cols));
    const col = index % Math.max(1, cols);
    if (row >= rows) {
      break;
    }

    const x = layout.padding + col * (layout.cellWidth + layout.gap);
    const y = layout.padding + row * (layout.cellHeight + layout.noteHeight + layout.gap);

    if (options.showFrameIndex) {
      const label = `${options.frameIndexPrefix || 'S'}${index + 1}`;
      const badgePaddingX = Math.max(6, Math.round(layout.fontSize * 0.35));
      const badgeHeight = Math.max(18, Math.round(layout.fontSize * 1.15));
      const textWidth = context.measureText(label).width;
      const badgeWidth = Math.round(textWidth + badgePaddingX * 2);

      context.fillStyle = 'rgba(0,0,0,0.65)';
      context.fillRect(x + 6, y + 6, badgeWidth, badgeHeight);
      context.fillStyle = options.textColor;
      context.fillText(label, x + 6 + badgePaddingX, y + 6 + badgeHeight / 2);
    }

    if (options.showFrameNote) {
      const note = trimTextToWidth(
        context,
        frame.note || '',
        Math.max(20, layout.cellWidth - 14)
      );

      if (!note) {
        continue;
      }

      if (options.notePlacement === 'overlay') {
        const overlayHeight = Math.max(18, Math.round(layout.fontSize * 1.35));
        const overlayY = y + layout.cellHeight - overlayHeight;
        context.fillStyle = 'rgba(0, 0, 0, 0.6)';
        context.fillRect(x, overlayY, layout.cellWidth, overlayHeight);
        context.fillStyle = options.textColor;
        context.fillText(note, x + 7, overlayY + overlayHeight / 2);
      } else if (layout.noteHeight > 0) {
        const noteY = y + layout.cellHeight + layout.noteHeight / 2;
        context.fillStyle = options.textColor;
        context.fillText(note, x + 4, noteY);
      }
    }
  }

  return canvasToDataUrl(canvas);
}

export async function exportStoryboardImages({
  nodeId,
  gridRows,
  gridCols,
  orderedFrames,
  exportOptions,
  createExportNode,
  linkExportNode,
}: ExportStoryboardImagesParams): Promise<void> {
  const traceId = `${nodeId}-${Date.now()}`;
  const traceStart = performance.now();
  exportTraceInfo('start', {
    traceId,
    nodeId,
    rows: gridRows,
    cols: gridCols,
    frameCount: orderedFrames.length,
  });

  try {
    const stageFrameStart = performance.now();
    const frameSources = orderedFrames.map((frame) => frame.imageUrl ?? frame.previewImageUrl ?? '');
    if (frameSources.every((source) => !source)) {
      throw new Error('没有可导出的图片');
    }
    exportTraceInfo('frame-sources-ready', {
      traceId,
      elapsedMs: Math.round(performance.now() - stageFrameStart),
      nonEmptyFrames: frameSources.filter((source) => source.length > 0).length,
    });

    const rawGap = clamp(Math.round(exportOptions.cellGap), 0, 120);
    const rawPadding = 0;
    const fontPercent = clamp(
      Number.isFinite(exportOptions.fontSize) ? exportOptions.fontSize : 4,
      1,
      20
    );

    const firstFrameSource = frameSources.find((source) => source.length > 0) ?? null;
    let referenceFrameHeight = 1024;
    if (firstFrameSource) {
      const fontProbeStart = performance.now();
      try {
        const referenceImage = await loadImageElement(firstFrameSource);
        referenceFrameHeight = Math.max(
          64,
          referenceImage.naturalHeight || referenceImage.height || referenceFrameHeight
        );
      } catch {
        // keep fallback size when reference frame cannot be read
      }
      exportTraceInfo('font-reference-resolved', {
        traceId,
        elapsedMs: Math.round(performance.now() - fontProbeStart),
        referenceFrameHeight,
      });
    }

    const rawFontSize = clamp(
      Math.round(referenceFrameHeight * (fontPercent / 100)),
      10,
      240
    );
    const rawNoteHeight =
      exportOptions.showFrameNote && exportOptions.notePlacement === 'bottom'
        ? Math.max(Math.round(rawFontSize * 1.7), 24)
        : 0;

    const mergeStart = performance.now();
    const mergeResult = await mergeStoryboardImages({
      frameSources,
      rows: gridRows,
      cols: gridCols,
      cellGap: rawGap,
      outerPadding: rawPadding,
      noteHeight: rawNoteHeight,
      fontSize: rawFontSize,
      backgroundColor: exportOptions.backgroundColor,
      maxDimension: EXPORT_MAX_DIMENSION,
      showFrameIndex: exportOptions.showFrameIndex,
      showFrameNote: exportOptions.showFrameNote,
      notePlacement: exportOptions.notePlacement,
      imageFit: exportOptions.imageFit,
      frameIndexPrefix: exportOptions.frameIndexPrefix,
      textColor: exportOptions.textColor,
      frameNotes: orderedFrames.map((frame) => frame.note ?? ''),
    });
    exportTraceInfo('merge-done', {
      traceId,
      elapsedMs: Math.round(performance.now() - mergeStart),
      canvasWidth: mergeResult.canvasWidth,
      canvasHeight: mergeResult.canvasHeight,
      textOverlayApplied: mergeResult.textOverlayApplied,
    });

    const aspectRatio = reduceAspectRatio(mergeResult.canvasWidth, mergeResult.canvasHeight);
    const needsOverlay = (exportOptions.showFrameIndex || exportOptions.showFrameNote) && !mergeResult.textOverlayApplied;
    let finalImagePath = mergeResult.imagePath;
    let finalPreviewPath = mergeResult.imagePath;

    if (needsOverlay) {
      const overlayStart = performance.now();
      const mergedBlob = await applyStoryboardTextOverlay(
        mergeResult.imagePath,
        orderedFrames,
        exportOptions,
        gridRows,
        gridCols,
        mergeResult
      );
      exportTraceInfo('overlay-done', {
        traceId,
        elapsedMs: Math.round(performance.now() - overlayStart),
        dataUrlLength: mergedBlob.length,
      });

      const persistStart = performance.now();
      finalImagePath = await persistImageLocally(mergedBlob);
      finalPreviewPath = finalImagePath;
      exportTraceInfo('overlay-persisted', {
        traceId,
        elapsedMs: Math.round(performance.now() - persistStart),
        persistedPath: finalImagePath,
      });
    }

    const metadataStart = performance.now();
    const shouldEmbedMetadataInFrontend = needsOverlay || !mergeResult.metadataEmbedded;
    if (shouldEmbedMetadataInFrontend) {
      const metadataFrameNotes = orderedFrames.map((frame) => frame.note ?? '');
      const imagePathWithMetadata = await embedStoryboardImageMetadata(finalImagePath, {
        gridRows,
        gridCols,
        frameNotes: metadataFrameNotes,
      }).catch((error) => {
        exportTraceWarn('metadata-embed-failed(frontend)', { error });
        return finalImagePath;
      });
      finalImagePath = imagePathWithMetadata;
      finalPreviewPath = imagePathWithMetadata;
      exportTraceInfo('metadata-embedded', {
        traceId,
        elapsedMs: Math.round(performance.now() - metadataStart),
        imagePath: finalImagePath,
        by: 'frontend',
      });
    } else {
      exportTraceInfo('metadata-embedded', {
        traceId,
        elapsedMs: Math.round(performance.now() - metadataStart),
        imagePath: finalImagePath,
        by: 'rust-merge',
      });
    }

    const createNodeStart = performance.now();
    const createdNodeId = createExportNode(finalImagePath, aspectRatio, finalPreviewPath);
    exportTraceInfo('derived-node-created', {
      traceId,
      elapsedMs: Math.round(performance.now() - createNodeStart),
      createdNodeId,
      defaultTitle: EXPORT_RESULT_DISPLAY_NAME.storyboardSplitExport,
    });

    if (createdNodeId) {
      linkExportNode(createdNodeId);
    }

    exportTraceInfo('done', {
      traceId,
      totalElapsedMs: Math.round(performance.now() - traceStart),
    });
  } catch (error) {
    console.error(`${EXPORT_TRACE_PREFIX} failed`, {
      traceId,
      elapsedMs: Math.round(performance.now() - traceStart),
      error,
    });
    throw error;
  }
}
