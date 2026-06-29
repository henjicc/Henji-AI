import {
  CANVAS_NODE_TYPES,
  type CanvasNodeData,
  type ModelSelectorNodeData,
} from './canvasNodes';
import { DEFAULT_NODE_DISPLAY_NAME } from './nodeDisplay';
import { getDefaultModelId, type CanvasModelMediaType } from './defaultModels';
import type { NodeValueOutput } from './nodePorts';
import type { CanvasNodeDefinition, MenuIconKey } from './nodeRegistry';

/**
 * 模型选择器节点（按媒体类型选模型，输出 MODEL 值供下游节点的模型端口覆盖）。
 * 与数值/源节点同构：单一类型化输出端口，getValueOutput 产出 modelId。
 */

function modelValueOutput(data: CanvasNodeData): NodeValueOutput {
  return {
    socketType: 'MODEL',
    value: (data as ModelSelectorNodeData).modelId,
  };
}

function createModelSelectorDefinition(
  type:
    | typeof CANVAS_NODE_TYPES.imageModelSelector
    | typeof CANVAS_NODE_TYPES.videoModelSelector
    | typeof CANVAS_NODE_TYPES.audioModelSelector,
  options: {
    menuLabelKey: string;
    menuIcon: MenuIconKey;
    mediaType: CanvasModelMediaType;
  }
): CanvasNodeDefinition<ModelSelectorNodeData> {
  return {
    type,
    menuLabelKey: options.menuLabelKey,
    menuIcon: options.menuIcon,
    visibleInMenu: true,
    capabilities: {
      toolbar: false,
      promptInput: false,
    },
    connectivity: {
      sourceHandle: true,
      targetHandle: false,
      connectMenu: {
        fromSource: false,
        fromTarget: false,
      },
      manualSource: true,
    },
    getValueOutput: modelValueOutput,
    createDefaultData: () => ({
      displayName: DEFAULT_NODE_DISPLAY_NAME[type],
      modelId: getDefaultModelId(options.mediaType),
      isExpanded: true,
    }),
  };
}

export const imageModelSelectorNodeDefinition = createModelSelectorDefinition(
  CANVAS_NODE_TYPES.imageModelSelector,
  { menuLabelKey: 'node.menu.imageModelSelector', menuIcon: 'sparkles', mediaType: 'image' }
);

export const videoModelSelectorNodeDefinition = createModelSelectorDefinition(
  CANVAS_NODE_TYPES.videoModelSelector,
  { menuLabelKey: 'node.menu.videoModelSelector', menuIcon: 'video', mediaType: 'video' }
);

export const audioModelSelectorNodeDefinition = createModelSelectorDefinition(
  CANVAS_NODE_TYPES.audioModelSelector,
  { menuLabelKey: 'node.menu.audioModelSelector', menuIcon: 'audio', mediaType: 'audio' }
);
