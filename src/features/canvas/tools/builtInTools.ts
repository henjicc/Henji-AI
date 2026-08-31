import {
  NODE_TOOL_TYPES,
  isExportImageNode,
  isImageEditNode,
  isLayerStackResultNode,
  isUploadNode,
  type CanvasNode,
} from '../domain/canvasNodes';
import {
  IMAGE_EDIT_OPERATION_IDS,
  createEmptyImageEditDocument,
  imageEditDocumentToMarkDoc,
  stringifyImageEditDocument,
  stringifyMarkDoc,
} from '@/core/imageEdit';
import { EXPORT_RESULT_DISPLAY_NAME } from '../domain/nodeDisplay';
import type { CanvasToolPlugin, ToolOptions } from './types';
import { ANNOTATION_DEFAULT_STROKE_HEX } from '@/core/theme/colorTokens';
import { isImageEditorV3Enabled } from '@/platform/runtime';
import { CANVAS_EDIT_V3_SESSION_OPTION } from '../imageEditV3/canvasEditV3Contracts';
import {
  CANVAS_EDIT_V3_LAYER_STACK_OPTION,
  serializeLayerStackV1ForImageEditor,
} from '../imageEditV3/layerStackV1Adapter';

function supportsImageSourceNode(node: CanvasNode): boolean {
  return isUploadNode(node) || isImageEditNode(node) || isExportImageNode(node);
}

/** 统一图片编辑工具:标记(框/箭头/序号/文字/画笔/马赛克)+ 裁剪 + 旋转翻转 */
export const imageEditToolPlugin: CanvasToolPlugin = {
  type: NODE_TOOL_TYPES.edit,
  label: '编辑',
  icon: 'edit',
  editor: 'edit',
  dialog: {
    size: 'workspace',
    resultNodeTitle: '编辑结果',
  },
  operationIds: Object.values(IMAGE_EDIT_OPERATION_IDS),
  supportsNode: (node) => (
    supportsImageSourceNode(node)
    || (isImageEditorV3Enabled() && isLayerStackResultNode(node))
  ) && Boolean(node.data.imageUrl),
  createInitialOptions: (node): ToolOptions => {
    if (
      isImageEditorV3Enabled()
      && isLayerStackResultNode(node)
      && node.data.layerStackDocument
    ) {
      return {
        [CANVAS_EDIT_V3_LAYER_STACK_OPTION]: serializeLayerStackV1ForImageEditor(
          node.data.layerStackDocument,
        ),
      };
    }
    if (isImageEditorV3Enabled() && node.data.imageEditSession !== undefined) {
      return {
        [CANVAS_EDIT_V3_SESSION_OPTION]: JSON.stringify(node.data.imageEditSession),
      };
    }
    const document = createEmptyImageEditDocument();
    return {
      color: ANNOTATION_DEFAULT_STROKE_HEX,
      lineWidthPercent: 0.4,
      fontSizePercent: 10,
      document: stringifyImageEditDocument(document),
      markDoc: stringifyMarkDoc(imageEditDocumentToMarkDoc(document)),
    };
  },
  fields: [],
  execute: async (sourceImageUrl, options, context) =>
    await context.processTool(NODE_TOOL_TYPES.edit, sourceImageUrl, options),
};

export const splitStoryboardToolPlugin: CanvasToolPlugin = {
  type: NODE_TOOL_TYPES.splitStoryboard,
  label: '切割',
  icon: 'split',
  editor: 'split',
  dialog: {
    size: 'editor',
    resultNodeTitle: EXPORT_RESULT_DISPLAY_NAME.generic,
    preloadStoryboardMetadata: true,
  },
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
