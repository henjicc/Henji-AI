import { ScanLine } from 'lucide-react';
import { IMAGE_EDIT_OPERATION_IDS } from '@/core/imageEdit';
import { GeometryInspector } from './geometry/GeometryInspector';
import type { ImageEditorToolDefinition } from './types';

export class ImageEditorToolRegistrationError extends Error {}

export class ImageEditorToolRegistry {
  private readonly definitions = new Map<string, ImageEditorToolDefinition>();

  register(definition: ImageEditorToolDefinition): void {
    if (this.definitions.has(definition.id)) {
      throw new ImageEditorToolRegistrationError(`图片编辑工具已注册：${definition.id}`);
    }
    this.definitions.set(definition.id, definition);
  }

  get(toolId: string): ImageEditorToolDefinition | null {
    return this.definitions.get(toolId) ?? null;
  }

  list(): ImageEditorToolDefinition[] {
    return [...this.definitions.values()];
  }
}

export const imageEditorToolRegistry = new ImageEditorToolRegistry();
imageEditorToolRegistry.register({
  id: 'geometry',
  label: '几何',
  operationId: IMAGE_EDIT_OPERATION_IDS.orientation,
  icon: ScanLine,
  inspector: GeometryInspector,
});

export function getImageEditorTools(): ImageEditorToolDefinition[] {
  return imageEditorToolRegistry.list();
}

export function getImageEditorTool(toolId: string): ImageEditorToolDefinition | null {
  return imageEditorToolRegistry.get(toolId);
}
