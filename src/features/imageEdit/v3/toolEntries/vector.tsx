import type { ToolDefinition, ToolOverlaySlot } from '../toolFramework/types';
import { toolManifest } from '../tools/vector/manifest';
import { VectorOverlay } from '../tools/vector/VectorOverlay';
const overlay: ToolOverlaySlot = { id: 'vector', activeOnly: true, requiresLayout: true, resetOnCancel: true, render: context => <VectorOverlay {...context} /> };
export const tools: readonly ToolDefinition[] = toolManifest.map(entry => ({ ...entry, overlays: [overlay] }));
