import type { CanvasNode, NodeToolType } from '../domain/canvasNodes';
import { imageEditOperationRegistry } from '@/core/imageEdit';
import { builtInToolPlugins } from './builtInTools';
import type { CanvasToolPlugin } from './types';

export class CanvasToolRegistrationError extends Error {}

function createToolRegistry(plugins: readonly CanvasToolPlugin[]): Map<NodeToolType, CanvasToolPlugin> {
  const registry = new Map<NodeToolType, CanvasToolPlugin>();
  for (const plugin of plugins) {
    if (registry.has(plugin.type)) {
      throw new CanvasToolRegistrationError(`画布工具已注册：${plugin.type}`);
    }
    for (const operationId of plugin.operationIds ?? []) {
      if (!imageEditOperationRegistry.get(operationId)) {
        throw new CanvasToolRegistrationError(
          `画布工具 ${plugin.type} 引用了未知图片操作：${operationId}`
        );
      }
    }
    registry.set(plugin.type, plugin);
  }
  return registry;
}

const toolRegistry = createToolRegistry(builtInToolPlugins);

export function getToolPlugin(toolType: NodeToolType): CanvasToolPlugin | null {
  return toolRegistry.get(toolType) ?? null;
}

export function getNodeToolPlugins(node: CanvasNode): CanvasToolPlugin[] {
  return [...toolRegistry.values()].filter((plugin) => plugin.supportsNode(node));
}

export function getRegisteredToolPlugins(): CanvasToolPlugin[] {
  return [...toolRegistry.values()];
}
