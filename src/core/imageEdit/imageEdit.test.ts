import { describe, expect, it, vi } from 'vitest';
import { ANNOTATION_DEFAULT_STROKE_HEX } from '@/core/theme/colorTokens';
import {
  IMAGE_EDIT_OPERATION_IDS,
  ImageEditOperationRegistry,
  InvalidImageEditOperationParamsError,
  UnsupportedImageEditOperationError,
  coerceImageEditSession,
  createBuiltInImageEditOperationRegistry,
  createEmptyImageEditDocument,
  createImageEditDocumentFromMarkDoc,
  createImageEditExecutionPort,
  decodeImageEditDocument,
  imageEditDocumentToMarkDoc,
  replaceMarkDocInImageEditDocument,
  type ImageEditDocument,
  type ImageMarkDoc,
} from './index';

function createMarkDoc(): ImageMarkDoc {
  return {
    version: 1,
    orientation: { rotate: 90, mirrored: true },
    crop: { x: 4, y: 6, width: 80, height: 60 },
    items: [{
      id: 'rect-1',
      type: 'rect',
      x: 10,
      y: 12,
      width: 30,
      height: 20,
      stroke: ANNOTATION_DEFAULT_STROKE_HEX,
      lineWidth: 3,
    }],
  };
}

describe('图片编辑文档兼容契约', () => {
  it('按朝向、标注、裁剪顺序迁移 V1 并可无损投影回旧文档', () => {
    const source = createMarkDoc();
    const decoded = decodeImageEditDocument(source);

    expect(decoded).toMatchObject({ sourceFormat: 'v1', migrated: true, issues: [] });
    expect(decoded.document.operations.map((operation) => operation.operationId)).toEqual([
      IMAGE_EDIT_OPERATION_IDS.orientation,
      IMAGE_EDIT_OPERATION_IDS.annotations,
      IMAGE_EDIT_OPERATION_IDS.crop,
    ]);
    expect(imageEditDocumentToMarkDoc(decoded.document)).toEqual(source);
  });

  it('保留合法未知操作，并在更新标注投影时保持实例位置', () => {
    const source = createImageEditDocumentFromMarkDoc(createMarkDoc());
    const unknownOperation = {
      id: 'future-effect-1',
      operationId: 'image.future-effect',
      enabled: true,
      params: { amount: 0.5 },
    };
    source.operations.splice(1, 0, unknownOperation);

    const decoded = decodeImageEditDocument(JSON.stringify(source));
    expect(decoded.document.operations[1]).toEqual(unknownOperation);

    const nextMarkDoc = { ...createMarkDoc(), crop: null };
    const replaced = replaceMarkDocInImageEditDocument(decoded.document, nextMarkDoc);
    expect(replaced.operations[1]).toEqual(unknownOperation);
    expect(imageEditDocumentToMarkDoc(replaced)).toEqual(nextMarkDoc);
  });

  it('对损坏 JSON、未知版本和非法 V2 操作确定回退空文档', () => {
    expect(decodeImageEditDocument('{').issues).toEqual(['invalid-json']);
    expect(decodeImageEditDocument({ version: 9 }).sourceFormat).toBe('unknown-version');

    const invalidOrientation = decodeImageEditDocument({
      version: 2,
      operations: [{
        id: 'orientation',
        operationId: IMAGE_EDIT_OPERATION_IDS.orientation,
        enabled: true,
        params: { rotate: 45, mirrored: false },
      }],
    });
    expect(invalidOrientation.issues).toEqual(['invalid-operation']);
    expect(invalidOrientation.document).toEqual(createEmptyImageEditDocument());

    const invalidEnabled = decodeImageEditDocument({
      version: 2,
      operations: [{
        id: 'orientation',
        operationId: IMAGE_EDIT_OPERATION_IDS.orientation,
        enabled: 'true',
        params: { rotate: 0, mirrored: false },
      }],
    });
    expect(invalidEnabled.issues).toEqual(['invalid-operation']);
  });

  it('兼容旧编辑状态和旧会话并优先保留原图来源', () => {
    const legacy = coerceImageEditSession({
      originalSrc: 'legacy-source',
      canvas: {
        annotations: [{
          id: 'ellipse-1',
          type: 'circle',
          x: 50,
          y: 40,
          radiusX: 10,
          radiusY: 5,
          stroke: ANNOTATION_DEFAULT_STROKE_HEX,
          strokeWidth: 2,
        }],
        rotation: 90,
        flipH: true,
        flipV: false,
        cropRect: { x: 2, y: 3, width: 40, height: 30 },
      },
    }, 'fallback-source');

    expect(legacy.sourceUrl).toBe('legacy-source');
    expect(imageEditDocumentToMarkDoc(legacy.document)).toMatchObject({
      orientation: { rotate: 90, mirrored: true },
      crop: { x: 2, y: 3, width: 40, height: 30 },
      items: [{ type: 'ellipse', x: 40, y: 35, width: 20, height: 10 }],
    });

    const oldSession = coerceImageEditSession({ sourceUrl: 'session-source', doc: createMarkDoc() }, 'fallback-source');
    expect(oldSession.sourceUrl).toBe('session-source');
    expect(imageEditDocumentToMarkDoc(oldSession.document)).toEqual(createMarkDoc());
  });
});

describe('图片操作注册与执行端口', () => {
  it('拒绝重复和未知操作，并在执行前传入校验后的完整文档', async () => {
    const registry = createBuiltInImageEditOperationRegistry();
    const document = createImageEditDocumentFromMarkDoc(createMarkDoc());
    const executor = {
      id: 'test-executor',
      execute: vi.fn(async () => 'rendered-image'),
    };
    const port = createImageEditExecutionPort(registry, executor);

    await expect(port.execute({ sourceImageUrl: 'source-image', document })).resolves.toEqual({
      outputImageUrl: 'rendered-image',
      document,
      executorId: 'test-executor',
    });
    expect(executor.execute).toHaveBeenCalledWith({ sourceImageUrl: 'source-image', document });

    const duplicate: ImageEditDocument = {
      ...document,
      operations: [...document.operations, { ...document.operations[0], id: 'duplicate-orientation' }],
    };
    await expect(port.execute({ sourceImageUrl: 'source-image', document: duplicate }))
      .rejects.toBeInstanceOf(InvalidImageEditOperationParamsError);

    const unknown: ImageEditDocument = {
      version: 2,
      operations: [{ id: 'unknown', operationId: 'image.unknown', enabled: true, params: {} }],
    };
    await expect(port.execute({ sourceImageUrl: 'source-image', document: unknown }))
      .rejects.toBeInstanceOf(UnsupportedImageEditOperationError);
    expect(executor.execute).toHaveBeenCalledTimes(1);
  });

  it('禁止同一个操作定义重复注册', () => {
    const registry = new ImageEditOperationRegistry();
    const definition = {
      id: 'image.test',
      stage: 'effect' as const,
      order: 1,
      supportsMultiple: false,
      createDefaultParams: () => ({}),
      parseParams: () => ({}),
    };
    registry.register(definition);
    expect(() => registry.register(definition)).toThrow('图片操作已注册：image.test');
  });
});
