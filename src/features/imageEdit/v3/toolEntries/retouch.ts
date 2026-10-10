import { rasterBrushToolSlotV3 } from '../editor/rasterBrushToolSlotV3';
import { toolManifest } from '../tools/retouch/manifest';
import { RetouchOptions } from '../tools/retouch/RetouchOptions';
import type { ToolDefinition } from '../toolFramework/types';

export const tools: readonly ToolDefinition[] = toolManifest.map(definition => ({ ...definition, Options: RetouchOptions,
  overlays: definition.id === 'content-aware-fill' ? [] : [rasterBrushToolSlotV3] }));
