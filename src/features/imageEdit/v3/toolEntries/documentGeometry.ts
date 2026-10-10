import { toolManifest } from '../tools/documentGeometry/manifest';
import { DocumentGeometryOptionsV3 } from '../tools/documentGeometry/Options';
import type { ToolDefinition } from '../toolFramework/types';
export const tools: readonly ToolDefinition[] = toolManifest.map(definition => ({ ...definition, Options: DocumentGeometryOptionsV3 }));
