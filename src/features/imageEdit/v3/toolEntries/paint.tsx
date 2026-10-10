import { rasterBrushToolSlotV3 } from '../editor/rasterBrushToolSlotV3';
import { PaintFillOverlayV3 } from '../tools/paint/PaintFillOverlay';
import { PaintOptionsV3 } from '../tools/paint/PaintOptions';
import { toolManifest } from '../tools/paint/manifest';
import type { ToolDefinition, ToolOverlaySlot } from '../toolFramework/types';

const fill: ToolOverlaySlot = { id: 'paint-fill', activeOnly: true, resetOnCancel: true, render: context => <PaintFillOverlayV3 {...context} /> };
export const tools: readonly ToolDefinition[] = toolManifest.map(definition => ({ ...definition, Options: PaintOptionsV3,
  overlays: [definition.id === 'paint-gradient' || definition.id === 'paint-fill' ? fill : rasterBrushToolSlotV3] }));
