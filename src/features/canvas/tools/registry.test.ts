import { describe, expect, it, vi } from 'vitest';
import {
  IMAGE_EDIT_OPERATION_IDS,
  imageEditDocumentToMarkDoc,
  parseImageEditDocument,
  parseMarkDoc,
} from '@/core/imageEdit';
import { CANVAS_NODE_TYPES, NODE_TOOL_TYPES, type CanvasNode } from '../domain/canvasNodes';
import { imageEditToolPlugin } from './builtInTools';
import {
  CanvasToolRegistrationError,
  createCanvasToolRegistry,
  getToolPlugin,
} from './registry';

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
});
