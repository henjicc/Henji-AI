import {
  CANVAS_NODE_TYPES,
  type CanvasNodeData,
  type ValueSourceNodeData,
} from './canvasNodes';
import { DEFAULT_NODE_DISPLAY_NAME } from './nodeDisplay';
import type { SocketType } from '@/core/types/SocketType';
import type { NodeValueOutput } from './nodePorts';
import type { CanvasNodeDefinition, MenuIconKey } from './nodeRegistry';

/**
 * 数值/源节点定义（借鉴 ComfyUI 的 primitive 节点）。
 *
 * - 仅一个类型化输出端口（manualSource），可 fan-out 给多个下游参数端口
 * - 无媒体端口、无生成；getValueOutput 声明该节点产出的标量值与插槽类型
 */

function valueOutput(socketType: SocketType) {
  return (data: CanvasNodeData): NodeValueOutput => ({
    socketType,
    value: (data as ValueSourceNodeData).value,
  });
}

function createValueSourceDefinition(
  type:
    | typeof CANVAS_NODE_TYPES.intSource
    | typeof CANVAS_NODE_TYPES.floatSource
    | typeof CANVAS_NODE_TYPES.stringSource
    | typeof CANVAS_NODE_TYPES.booleanSource,
  options: {
    menuLabelKey: string;
    menuIcon: MenuIconKey;
    socketType: SocketType;
    defaultValue: number | string | boolean;
  }
): CanvasNodeDefinition<ValueSourceNodeData> {
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
    getValueOutput: valueOutput(options.socketType),
    createDefaultData: () => ({
      displayName: DEFAULT_NODE_DISPLAY_NAME[type],
      value: options.defaultValue,
    }),
  };
}

export const intSourceNodeDefinition = createValueSourceDefinition(CANVAS_NODE_TYPES.intSource, {
  menuLabelKey: 'node.menu.intSource',
  menuIcon: 'number',
  socketType: 'INT',
  defaultValue: 0,
});

export const floatSourceNodeDefinition = createValueSourceDefinition(CANVAS_NODE_TYPES.floatSource, {
  menuLabelKey: 'node.menu.floatSource',
  menuIcon: 'number',
  socketType: 'FLOAT',
  defaultValue: 0,
});

export const stringSourceNodeDefinition = createValueSourceDefinition(CANVAS_NODE_TYPES.stringSource, {
  menuLabelKey: 'node.menu.stringSource',
  menuIcon: 'text',
  socketType: 'STRING',
  defaultValue: '',
});

export const booleanSourceNodeDefinition = createValueSourceDefinition(CANVAS_NODE_TYPES.booleanSource, {
  menuLabelKey: 'node.menu.booleanSource',
  menuIcon: 'toggle',
  socketType: 'BOOLEAN',
  defaultValue: false,
});
