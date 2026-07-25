import {
  NODE_TOOL_TYPES,
  type NodeToolType,
  type StoryboardFrameItem,
} from '../domain/canvasNodes';
import { createLogger } from '@/core/logging';
import {
  canvasToDataUrl,
  detectAspectRatio,
  loadImageElement,
  persistImageLocally,
} from './imageData';
import { readStoryboardImageMetadata } from '@/commands/image';
import { isDesktopRuntime } from '@/platform/runtime';
import { parseImageEditDocument } from '@/core/imageEdit';
import { exportImageEditDocument } from '@/features/imageEdit/execution/browserImageEditExecution';
import type {
  IdGenerator,
  ImageSplitGateway,
  ToolProcessor,
  ToolProcessorResult,
} from './ports';

const logger = createLogger('features.canvas.application.toolProcessor');

type ToolProcessingHandler = (
  sourceImageUrl: string,
  options: DynamicValueMap
) => Promise<ToolProcessorResult>;

export class CanvasToolProcessor implements ToolProcessor {
  private readonly handlers: Map<NodeToolType, ToolProcessingHandler>;

  constructor(
    private readonly splitGateway: ImageSplitGateway,
    private readonly idGenerator: IdGenerator
  ) {
    this.handlers = new Map<NodeToolType, ToolProcessingHandler>([
      [NODE_TOOL_TYPES.edit, this.processImageEdit.bind(this)],
      [NODE_TOOL_TYPES.splitStoryboard, this.processStoryboardSplit.bind(this)],
    ]);
  }

  async process(
    toolType: NodeToolType,
    sourceImageUrl: string,
    options: DynamicValueMap
  ): Promise<ToolProcessorResult> {
    const handler = this.handlers.get(toolType);
    if (!handler) throw new Error(`不支持的工具类型：${toolType}`);

    logger.debug('canvas.tool.execute.start', { toolId: toolType });
    try {
      const result = await handler(sourceImageUrl, options);
      logger.info('canvas.tool.execute.completed', { toolId: toolType });
      return result;
    } catch (error) {
      logger.error('canvas.tool.execute.failed', {
        toolId: toolType,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async processImageEdit(
    sourceImageUrl: string,
    options: DynamicValueMap
  ): Promise<ToolProcessorResult> {
    const localSource = await persistImageLocally(sourceImageUrl);
    const document = parseImageEditDocument(options.document ?? options.markDoc);
    return {
      outputImageUrl: await exportImageEditDocument(localSource, document),
    };
  }

  private async processStoryboardSplit(
    sourceImageUrl: string,
    options: DynamicValueMap
  ): Promise<ToolProcessorResult> {
    const metadata = await this.readStoryboardMetadata(sourceImageUrl);
    return await this.splitStoryboard(
      sourceImageUrl,
      Number(options.rows ?? metadata?.gridRows ?? 3),
      Number(options.cols ?? metadata?.gridCols ?? 3),
      Number(options.lineThicknessPercent),
      Number(options.lineThickness ?? 0),
      metadata?.frameNotes
    );
  }

  private async splitStoryboard(
    sourceImage: string,
    rows: number,
    cols: number,
    lineThicknessPercent: number,
    lineThicknessPxFallback: number,
    frameNotes?: string[]
  ): Promise<ToolProcessorResult> {
    const normalizedRows = Number.isFinite(rows) ? rows : 3;
    const normalizedCols = Number.isFinite(cols) ? cols : 3;
    const normalizedLineThicknessPercent = Number.isFinite(lineThicknessPercent)
      ? lineThicknessPercent
      : NaN;
    const normalizedLineThicknessPxFallback = Number.isFinite(lineThicknessPxFallback)
      ? lineThicknessPxFallback
      : 0;

    const safeRows = Math.max(1, Math.floor(normalizedRows));
    const safeCols = Math.max(1, Math.floor(normalizedCols));
    const safeLineThickness = await this.resolveSplitLineThicknessPx(
      sourceImage,
      safeRows,
      safeCols,
      normalizedLineThicknessPercent,
      normalizedLineThicknessPxFallback
    );

    if (safeRows <= 0 || safeCols <= 0) {
      throw new Error('分镜行列必须大于 0');
    }

    let outputs: string[];
    try {
      outputs = await this.splitGateway.split(
        sourceImage,
        safeRows,
        safeCols,
        safeLineThickness
      );
    } catch (error) {
      if (isDesktopRuntime()) {
        throw error;
      }
      outputs = await this.localSplit(sourceImage, safeRows, safeCols, safeLineThickness);
    }

    const persistedFrameImages = await Promise.all(
      outputs.map(async (imageUrl) => await persistImageLocally(imageUrl))
    );

    let frameAspectRatio: string | undefined;
    const firstFrameImage = persistedFrameImages[0];
    if (firstFrameImage) {
      try {
        frameAspectRatio = await detectAspectRatio(firstFrameImage);
      } catch {
        frameAspectRatio = undefined;
      }
    }

    const resolvedFrameAspectRatio = frameAspectRatio ?? `${safeCols}:${safeRows}`;
    const frames: StoryboardFrameItem[] = persistedFrameImages.map((imageUrl, index) => ({
      id: this.idGenerator.next(),
      imageUrl,
      previewImageUrl: imageUrl,
      aspectRatio: resolvedFrameAspectRatio,
      note: typeof frameNotes?.[index] === 'string' ? frameNotes[index].trim() : '',
      order: index,
    }));

    return {
      storyboardFrames: frames,
      rows: safeRows,
      cols: safeCols,
      frameAspectRatio: resolvedFrameAspectRatio,
    };
  }

  private resolveMaxAllowedLineThickness(
    imageWidth: number,
    imageHeight: number,
    rows: number,
    cols: number
  ): number {
    const maxLineByWidth = cols > 1 ? Math.floor((imageWidth - cols) / (cols - 1)) : Number.MAX_SAFE_INTEGER;
    const maxLineByHeight = rows > 1 ? Math.floor((imageHeight - rows) / (rows - 1)) : Number.MAX_SAFE_INTEGER;
    return Math.max(0, Math.min(maxLineByWidth, maxLineByHeight));
  }

  private async resolveSplitLineThicknessPx(
    sourceImage: string,
    rows: number,
    cols: number,
    lineThicknessPercent: number,
    lineThicknessPxFallback: number
  ): Promise<number> {
    if (!Number.isFinite(lineThicknessPercent)) {
      return Math.max(0, Math.floor(lineThicknessPxFallback));
    }

    const normalizedPercent = Math.max(0, lineThicknessPercent);
    if (normalizedPercent <= 0) {
      return 0;
    }

    const image = await loadImageElement(sourceImage);
    const imageWidth = Math.max(1, image.naturalWidth);
    const imageHeight = Math.max(1, image.naturalHeight);
    const basis = Math.max(1, Math.min(imageWidth, imageHeight));
    const rawPixelThickness = Math.max(1, Math.round((basis * normalizedPercent) / 100));
    const maxAllowedThickness = this.resolveMaxAllowedLineThickness(imageWidth, imageHeight, rows, cols);
    return Math.max(0, Math.min(rawPixelThickness, maxAllowedThickness));
  }

  private async readStoryboardMetadata(
    sourceImage: string
  ): Promise<{ gridRows: number; gridCols: number; frameNotes: string[] } | null> {
    try {
      const metadata = await readStoryboardImageMetadata(sourceImage);
      if (!metadata) {
        return null;
      }

      return {
        gridRows: metadata.gridRows,
        gridCols: metadata.gridCols,
        frameNotes: Array.isArray(metadata.frameNotes) ? metadata.frameNotes : [],
      };
    } catch (error) {
      if (isDesktopRuntime()) {
        throw error;
      }
      return null;
    }
  }

  private splitIntoSegments(totalSize: number, segmentCount: number): number[] {
    const baseSize = Math.floor(totalSize / segmentCount);
    const remainder = totalSize % segmentCount;

    return Array.from(
      { length: segmentCount },
      (_item, index) => baseSize + (index < remainder ? 1 : 0)
    );
  }

  private async localSplit(
    sourceImage: string,
    rows: number,
    cols: number,
    lineThickness: number
  ): Promise<string[]> {
    const image = await loadImageElement(sourceImage);

    const maxAllowedLine = this.resolveMaxAllowedLineThickness(
      image.naturalWidth,
      image.naturalHeight,
      rows,
      cols
    );
    const resolvedLineThickness = Math.min(Math.max(0, lineThickness), maxAllowedLine);

    const usableWidth = image.naturalWidth - (cols - 1) * resolvedLineThickness;
    const usableHeight = image.naturalHeight - (rows - 1) * resolvedLineThickness;

    if (usableWidth < cols || usableHeight < rows) {
      throw new Error('分割线过粗，无法完成切割');
    }

    const columnWidths = this.splitIntoSegments(usableWidth, cols);
    const rowHeights = this.splitIntoSegments(usableHeight, rows);

    const results: string[] = [];

    const yOffsets: number[] = [];
    let yCursor = 0;
    for (let row = 0; row < rows; row += 1) {
      yOffsets.push(yCursor);
      yCursor += rowHeights[row];
      if (row < rows - 1) {
        yCursor += resolvedLineThickness;
      }
    }

    const xOffsets: number[] = [];
    let xCursor = 0;
    for (let col = 0; col < cols; col += 1) {
      xOffsets.push(xCursor);
      xCursor += columnWidths[col];
      if (col < cols - 1) {
        xCursor += resolvedLineThickness;
      }
    }

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const targetWidth = columnWidths[col];
        const targetHeight = rowHeights[row];

        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;

        const context = canvas.getContext('2d');
        if (!context) {
          throw new Error('无法初始化画布');
        }

        context.drawImage(
          image,
          xOffsets[col],
          yOffsets[row],
          targetWidth,
          targetHeight,
          0,
          0,
          targetWidth,
          targetHeight
        );
        results.push(canvasToDataUrl(canvas));
      }
    }

    return results;
  }
}
