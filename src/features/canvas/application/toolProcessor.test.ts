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

const v3Mocks = vi.hoisted(() => ({
  enabled: false,
  loadDocument: vi.fn(),
  materialize: vi.fn(),
}));

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
  isImageEditorV3Enabled: vi.fn(() => v3Mocks.enabled),
}));

vi.mock('@/commands/imageEditorV3', () => ({
  createImageEditorV3RequestId: vi.fn(() => 'canvas-edit-request'),
  loadImageEditorV3Document: v3Mocks.loadDocument,
}));

vi.mock('../imageEditV3/canvasEditV3Materialization', () => ({
  materializeCanvasEditV3Snapshot: v3Mocks.materialize,
}));

vi.mock('@/features/imageEdit/execution/browserImageEditExecution', () => ({
  exportImageEditDocument: vi.fn(async (_source: string, _document: unknown) => 'rendered-image'),
}));

describe('CanvasToolProcessor 图片编辑分发', () => {
  let processor: CanvasToolProcessor;
  let splitGateway: ImageSplitGateway;

  beforeEach(() => {
    vi.clearAllMocks();
    v3Mocks.enabled = false;
    v3Mocks.loadDocument.mockReset();
    v3Mocks.materialize.mockReset();
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

  it('开关开启后只加载同 revision 权威快照并返回受管媒体与稳定会话', async () => {
    v3Mocks.enabled = true;
    const sourceRef = `sha256:${'a'.repeat(64)}` as const;
    const previewRef = `sha256:${'b'.repeat(64)}` as const;
    const fingerprint = `sha256:${'c'.repeat(64)}` as const;
    const document = {
      version: 3 as const,
      id: 'canvas-document',
      revision: 2,
      geometry: {
        width: 96,
        height: 64,
        orientation: { rotate: 0 as const, mirrored: false },
        crop: null,
      },
      color: {
        workingSpace: 'srgb' as const,
        bitDepth: 8 as const,
        transferFunction: 'srgb' as const,
        hdrMetadata: null,
        iccProfileResourceId: null,
      },
      layers: [],
    };
    const snapshot = {
      documentRef: 'image-edit-v3:canvas-document' as const,
      revision: 2,
      previewRef,
      document,
      history: null,
      resourceRefs: [sourceRef],
      resources: [{ resourceRef: sourceRef, byteLength: 128, mediaType: 'image/png' }],
      sourceFingerprint: fingerprint,
    };
    const outputUrl = `henji-media://image-editor-v3/${'d'.repeat(64)}`;
    const session = {
      kind: 'image-edit-v3' as const,
      sourceUrl: 'source-image',
      documentRef: snapshot.documentRef,
      revision: 2,
      previewRef,
    };
    const outputSession = { ...session, sourceUrl: outputUrl };
    v3Mocks.loadDocument.mockResolvedValue(snapshot);
    v3Mocks.materialize.mockResolvedValue({
      raster: { mediaUrl: outputUrl, width: 96, height: 64 },
      session: outputSession,
    });

    const signal = new AbortController().signal;
    const result = await processor.process(NODE_TOOL_TYPES.edit, 'source-image', {
      imageEditSession: JSON.stringify(session),
    }, signal);

    expect(v3Mocks.loadDocument).toHaveBeenCalledWith({
      requestId: 'canvas-edit-request',
      documentRef: snapshot.documentRef,
    }, signal);
    expect(v3Mocks.materialize).toHaveBeenCalledWith(snapshot, 'source-image', signal);
    expect(result).toEqual({
      outputImageUrl: outputUrl,
      outputImageSize: { width: 96, height: 64 },
      imageEditSession: outputSession,
    });
    const { persistImageLocally } = await import('./imageData');
    expect(vi.mocked(persistImageLocally)).not.toHaveBeenCalledWith('source-image');
  });

  it('开关开启后拒绝缺失或 stale 会话，并把取消信号传到权威加载', async () => {
    v3Mocks.enabled = true;
    await expect(processor.process(NODE_TOOL_TYPES.edit, 'source-image', {}))
      .rejects.toThrow('缺少已保存的权威会话引用');

    const session = {
      kind: 'image-edit-v3' as const,
      sourceUrl: 'source-image',
      documentRef: 'image-edit-v3:canvas-document' as const,
      revision: 2,
      previewRef: null,
    };
    v3Mocks.loadDocument.mockResolvedValue({
      documentRef: session.documentRef,
      revision: 3,
      previewRef: null,
      document: {
        version: 3,
        id: 'canvas-document',
        revision: 3,
        geometry: {
          width: 1,
          height: 1,
          orientation: { rotate: 0, mirrored: false },
          crop: null,
        },
        color: {
          workingSpace: 'srgb',
          bitDepth: 8,
          transferFunction: 'srgb',
          hdrMetadata: null,
          iccProfileResourceId: null,
        },
        layers: [],
      },
      history: null,
      resourceRefs: [],
      resources: [],
      sourceFingerprint: `sha256:${'c'.repeat(64)}`,
    });
    const controller = new AbortController();
    await expect(processor.process(NODE_TOOL_TYPES.edit, 'source-image', {
      imageEditSession: JSON.stringify(session),
    }, controller.signal)).rejects.toThrow('版本与权威快照不一致');
    expect(v3Mocks.loadDocument.mock.calls.at(-1)?.[1]).toBe(controller.signal);
    expect(v3Mocks.materialize).not.toHaveBeenCalled();
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
