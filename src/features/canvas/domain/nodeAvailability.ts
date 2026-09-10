import { registry } from '@/core/ModelRegistry';
import { CANVAS_IMAGE_CAPABILITY_IDS } from '@/core/canvas/imageCapabilityIds';
import { getCanvasNodeDefinition } from './nodeRegistry';

const capabilityIds = new Set<string>(Object.values(CANVAS_IMAGE_CAPABILITY_IDS));

/** 可用性是运行时目录状态，不修改工程里保存的类型或参数。 */
export function isCanvasNodeUnavailable(node: { type?: string; data: Record<string, unknown> }): boolean {
  const definition = node.type ? getCanvasNodeDefinition(node.type) : undefined;
  if (!definition) return true;
  const { capabilityId, modelId } = node.data;
  if (typeof capabilityId === 'string' && capabilityId && !capabilityIds.has(capabilityId)) return true;
  return Boolean(definition.generation) && typeof modelId === 'string' && modelId.length > 0 && !registry.getModel(modelId);
}
