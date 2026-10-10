import { toolManifest } from '../tools/aiWorkflows/manifest';
import { OutpaintOptionsV3, OutpaintStatusV3 } from '../tools/aiWorkflows/OutpaintOptionsV3';
import type { ToolDefinition } from '../toolFramework/types';
export const tools: readonly ToolDefinition[] = toolManifest.map(definition => ({ ...definition, Options: OutpaintOptionsV3,
  overlays: [{ id: 'outpaint-status', activeOnly: false, render: context => <OutpaintStatusV3 {...context} /> }] }));
