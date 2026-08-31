import { describe, expect, it, vi } from 'vitest';
import {
  IMAGE_EDIT_OPERATION_IDS,
  imageEditDocumentToMarkDoc,
  parseImageEditDocument,
  parseMarkDoc,
} from '@/core/imageEdit';
import { CANVAS_NODE_TYPES, NODE_TOOL_TYPES, type CanvasNode } from '../domain/canvasNodes';
import {
  createStableLayerId,
  createStableLayerResourceId,
  createStableLayerStackId,
  type LayerStackDocumentV1,
} from '../domain/layerStack';
import { CANVAS_EDIT_V3_LAYER_STACK_OPTION } from '../imageEditV3/layerStackV1Adapter';
import { imageEditToolPlugin } from './builtInTools';
import {
  CanvasToolRegistrationError,
  createCanvasToolRegistry,
  getToolPlugin,
} from './registry';

const runtimeMocks = vi.hoisted(() => ({ imageEditorV3: false }));

vi.mock('@/platform/runtime', () => ({
  isImageEditorV3Enabled: () => runtimeMocks.imageEditorV3,
}));

function layerStackDocument(): LayerStackDocumentV1 {
  const completionId = 'registry-layer-stack';
  const stackId = createStableLayerStackId(completionId);
  const layerId = createStableLayerId(stackId, 0);
  const resourceId = createStableLayerResourceId(stackId, 0);
  return {
    version: 1,
    stackId,
    status: 'ready',
    source: {
      capabilityId: 'image.layer-separation',
      sourceNodeId: 'source-node',
      inputResourceId: 'input-resource',
      providerId: 'provider',
      modelId: 'model',
      completionId,
    },
    canvas: {
      width: 64,
      height: 64,
      colorSpace: 'srgb',
      alphaMode: 'straight',
      compositeOperation: 'source-over',
      clipPolicy: 'canvas-bounds',
    },
    compositeResourceId: 'composite',
    thumbnailResourceId: 'thumbnail',
    layers: [{
      version: 1,
      layerId,
      sourceOutputIndex: 0,
      providerZIndex: 0,
      order: 0,
      role: 'base',
      name: '背景',
      resourceId,
      placement: { x: 0, y: 0, width: 64, height: 64 },
      opacity: 1,
      visible: true,
      blendMode: 'normal',
      alpha: 'opaque',
    }],
    resources: [
      { version: 1, resourceId, status: 'ready', filePath: '/base.jpg', mimeType: 'image/jpeg', width: 64, height: 64, hasAlpha: false, byteLength: 100, sha256: 'base' },
      { version: 1, resourceId: 'composite', status: 'ready', filePath: '/composite.png', mimeType: 'image/png', width: 64, height: 64, hasAlpha: true, byteLength: 100, sha256: 'composite' },
      { version: 1, resourceId: 'thumbnail', status: 'ready', filePath: '/thumbnail.jpg', mimeType: 'image/jpeg', width: 32, height: 32, hasAlpha: false, byteLength: 100, sha256: 'thumbnail' },
    ],
  };
}

describe('画布图片工具注册', () => {
  const imageNode: CanvasNode = {
    id: 'image-node',
    type: CANVAS_NODE_TYPES.upload,
    position: { x: 0, y: 0 },
    data: { imageUrl: 'source-image', aspectRatio: '1:1' },
  };

  it('从注册信息提供编辑器策略，并让新旧文档初始值保持一致', () => {
    const plugin = getToolPlugin(NODE_TOOL_TYPES.edit);
    expect(plugin).toMatchObject({
      editor: 'edit',
      dialog: { resultNodeTitle: '编辑结果' },
      operationIds: Object.values(IMAGE_EDIT_OPERATION_IDS),
    });

    const options = imageEditToolPlugin.createInitialOptions(imageNode);
    const document = parseImageEditDocument(options.document);
    expect(imageEditDocumentToMarkDoc(document)).toEqual(parseMarkDoc(options.markDoc));
  });

  it('拒绝重复工具类型和未注册的核心操作', () => {
    expect(() => createCanvasToolRegistry([imageEditToolPlugin, imageEditToolPlugin]))
      .toThrow(CanvasToolRegistrationError);
    expect(() => createCanvasToolRegistry([{
      ...imageEditToolPlugin,
      operationIds: ['image.unknown'],
    }])).toThrow('引用了未知图片操作：image.unknown');
  });

  it('通过插件执行上下文分发，不在插件内复制处理逻辑', async () => {
    const options = imageEditToolPlugin.createInitialOptions(imageNode);
    const processTool = vi.fn(async () => ({ outputImageUrl: 'rendered-image' }));

    await expect(imageEditToolPlugin.execute('source-image', options, { processTool }))
      .resolves.toEqual({ outputImageUrl: 'rendered-image' });
    expect(processTool).toHaveBeenCalledWith(NODE_TOOL_TYPES.edit, 'source-image', options);
  });

  it('开关开启后从派生节点恢复稳定 V3 会话，关闭时仍生成原 V2 初始值', () => {
    const session = {
      kind: 'image-edit-v3' as const,
      sourceUrl: 'henji-media://image-editor-v3/result',
      documentRef: 'image-edit-v3:canvas-document' as const,
      revision: 3,
      previewRef: `sha256:${'a'.repeat(64)}` as const,
    };
    const resultNode: CanvasNode = {
      ...imageNode,
      data: {
        ...imageNode.data,
        imageUrl: session.sourceUrl,
        imageEditSession: session,
      },
    };

    runtimeMocks.imageEditorV3 = true;
    expect(imageEditToolPlugin.createInitialOptions(resultNode)).toEqual({
      imageEditSession: JSON.stringify(session),
    });

    runtimeMocks.imageEditorV3 = false;
    const legacy = imageEditToolPlugin.createInitialOptions(resultNode);
    expect(typeof legacy.document).toBe('string');
    expect(typeof legacy.markDoc).toBe('string');
    expect(legacy).not.toHaveProperty('imageEditSession');
  });

  it('V3 开关开启时把图层分离结果作为多栅格图层输入，关闭时不暴露通用图片编辑工具', () => {
    const layerStackNode: CanvasNode = {
      id: 'layer-stack-node',
      type: CANVAS_NODE_TYPES.layerStackResult,
      position: { x: 0, y: 0 },
      data: {
        resultKind: 'layer-stack',
        imageUrl: '/composite.png',
        layerStackDocument: layerStackDocument(),
      },
    };

    runtimeMocks.imageEditorV3 = false;
    expect(imageEditToolPlugin.supportsNode(layerStackNode)).toBe(false);
    runtimeMocks.imageEditorV3 = true;
    expect(imageEditToolPlugin.supportsNode(layerStackNode)).toBe(true);
    const options = imageEditToolPlugin.createInitialOptions(layerStackNode);
    expect(JSON.parse(options[CANVAS_EDIT_V3_LAYER_STACK_OPTION] as string))
      .toEqual(layerStackNode.data.layerStackDocument);
  });
});
