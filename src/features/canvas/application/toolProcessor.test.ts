import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createEmptyImageEditDocument,
  imageEditDocumentToMarkDoc,
  stringifyImageEditDocument,
  stringifyMarkDoc,
  type ImageMarkDoc,
} from '@/core/imageEdit';
import { NODE_TOOL_TYPES, type NodeToolType } from '../domain/canvasNodes';
import type { ImageSplitGateway } from './ports';
import { CanvasToolProcessor } from './toolProcessor';

vi.mock('@/core/logging', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), error: vi.fn() }),
}));

vi.mock('./imageData', () => ({
  canvasToDataUrl: vi.fn(),
  detectAspectRatio: vi.fn(),
  loadImageElement: vi.fn(),
  persistImageLocally: vi.fn(async (source: string) => `local:${source}`),
}));

vi.mock('@/commands/image', () => ({
  readStoryboardImageMetadata: vi.fn(),
}));

vi.mock('@/platform/runtime', () => ({
  isDesktopRuntime: vi.fn(() => false),
}));

vi.mock('@/features/imageEdit/execution/browserImageEditExecution', () => ({
  exportImageEditDocument: vi.fn(async (_source: string, _document: unknown) => 'rendered-image'),
}));

describe('CanvasToolProcessor 图片编辑分发', () => {
  let processor: CanvasToolProcessor;
  let splitGateway: ImageSplitGateway;

  beforeEach(() => {
    splitGateway = { split: vi.fn(async () => []) };
    processor = new CanvasToolProcessor(splitGateway, { next: () => 'node-id' });
  });

  it('优先读取 V2 document 并通过统一浏览器执行端口输出结果', async () => {
    const document = createEmptyImageEditDocument();
    const result = await processor.process(NODE_TOOL_TYPES.edit, 'source-image', {
      document: stringifyImageEditDocument(document),
      markDoc: 'should-not-be-read',
    });

    expect(result).toEqual({ outputImageUrl: 'rendered-image' });
    const { persistImageLocally } = await import('./imageData');
    const { exportImageEditDocument } = await import('@/features/imageEdit/execution/browserImageEditExecution');
    expect(vi.mocked(persistImageLocally)).toHaveBeenCalledWith('source-image');
    expect(vi.mocked(exportImageEditDocument)).toHaveBeenCalledWith('local:source-image', document);
  });

  it('旧画布只提供 markDoc 时仍能迁移并执行', async () => {
    const markDoc: ImageMarkDoc = imageEditDocumentToMarkDoc(createEmptyImageEditDocument());
    const result = await processor.process(NODE_TOOL_TYPES.edit, 'legacy-source', {
      markDoc: stringifyMarkDoc(markDoc),
    });

    expect(result.outputImageUrl).toBe('rendered-image');
  });

  it('未知工具类型不执行任何处理器', async () => {
    await expect(processor.process('unknown' as NodeToolType, 'source-image', {}))
      .rejects.toThrow('不支持的工具类型：unknown');
    expect(splitGateway.split).not.toHaveBeenCalled();
  });

  it('宫格切分复用图片元数据并按行优先顺序返回持久化格子', async () => {
    const { readStoryboardImageMetadata } = await import('@/commands/image');
    const { detectAspectRatio } = await import('./imageData');
    vi.mocked(readStoryboardImageMetadata).mockResolvedValue({
      gridRows: 3,
      gridCols: 3,
      frameNotes: Array.from({ length: 9 }, (_, index) => `镜头 ${index + 1}`),
    });
    vi.mocked(detectAspectRatio).mockResolvedValue('1:1');
    vi.mocked(splitGateway.split).mockResolvedValue(
      Array.from({ length: 9 }, (_, index) => `/split-${index + 1}.png`),
    );

    const result = await processor.process(NODE_TOOL_TYPES.splitStoryboard, '/grid.png', {});

    expect(splitGateway.split).toHaveBeenCalledWith('/grid.png', 3, 3, 0);
    expect(result).toMatchObject({ rows: 3, cols: 3, frameAspectRatio: '1:1' });
    expect(result.storyboardFrames?.map((frame) => ({
      imageUrl: frame.imageUrl,
      note: frame.note,
      order: frame.order,
    }))).toEqual(Array.from({ length: 9 }, (_, index) => ({
      imageUrl: `local:/split-${index + 1}.png`,
      note: `镜头 ${index + 1}`,
      order: index,
    })));
  });

  it('无元数据时明确回退 3×3，非法数值不会传给底层切分服务', async () => {
    const { readStoryboardImageMetadata } = await import('@/commands/image');
    vi.mocked(readStoryboardImageMetadata).mockResolvedValue(null);
    vi.mocked(splitGateway.split).mockResolvedValue([]);

    const result = await processor.process(NODE_TOOL_TYPES.splitStoryboard, '/plain.png', {
      rows: 'invalid',
      cols: Number.NaN,
    });

    expect(splitGateway.split).toHaveBeenCalledWith('/plain.png', 3, 3, 0);
    expect(result).toMatchObject({ rows: 3, cols: 3, storyboardFrames: [] });
  });
});
