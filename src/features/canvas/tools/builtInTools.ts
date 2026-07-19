import {
  NODE_TOOL_TYPES,
  isExportImageNode,
  isImageEditNode,
  isUploadNode,
  type CanvasNode,
} from '../domain/canvasNodes';
import { createEmptyMarkDoc, stringifyMarkDoc } from '@/features/imageMark';
import type { CanvasToolPlugin } from './types';
import { ANNOTATION_DEFAULT_STROKE_HEX } from '@/core/theme/colorTokens';

function supportsImageSourceNode(node: CanvasNode): boolean {
  return isUploadNode(node) || isImageEditNode(node) || isExportImageNode(node);
}

/** 统一图片编辑工具:标记(框/箭头/序号/文字/画笔/马赛克)+ 裁剪 + 旋转翻转 */
export const imageEditToolPlugin: CanvasToolPlugin = {
  type: NODE_TOOL_TYPES.edit,
  label: '编辑',
  icon: 'edit',
  editor: 'edit',
  supportsNode: (node) => supportsImageSourceNode(node) && Boolean(node.data.imageUrl),
  createInitialOptions: () => ({
    color: ANNOTATION_DEFAULT_STROKE_HEX,
    lineWidthPercent: 0.4,
    fontSizePercent: 10,
    markDoc: stringifyMarkDoc(createEmptyMarkDoc()),
  }),
  fields: [],
  execute: async (sourceImageUrl, options, context) =>
    await context.processTool(NODE_TOOL_TYPES.edit, sourceImageUrl, options),
};

export const splitStoryboardToolPlugin: CanvasToolPlugin = {
  type: NODE_TOOL_TYPES.splitStoryboard,
  label: '切割',
  icon: 'split',
  editor: 'split',
  supportsNode: (node) => supportsImageSourceNode(node) && Boolean(node.data.imageUrl),
  createInitialOptions: () => ({
    rows: 3,
    cols: 3,
    lineThicknessPercent: 0.5,
  }),
  fields: [],
  execute: async (sourceImageUrl, options, context) =>
    await context.processTool(NODE_TOOL_TYPES.splitStoryboard, sourceImageUrl, options),
};

export const builtInToolPlugins: CanvasToolPlugin[] = [
  imageEditToolPlugin,
  splitStoryboardToolPlugin,
];
