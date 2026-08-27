import { Blend, ScanLine, Sparkles } from 'lucide-react';
import { BlurInspector } from './blur/BlurInspector';
import { GeometryInspector } from './geometry/GeometryInspector';
import { DiffusionInspector } from './diffusion/DiffusionInspector';
import { VgpuGlowInspector } from './vgpuGlow/VgpuGlowInspector';
import type { ImageEditorToolDefinition } from './types';
import { IMAGE_EDITOR_TOOL_CONTROL_DEFINITIONS } from './controlCatalog';
import { ICON_IMAGE_GLOW_PRO } from '@/core/theme/icons';

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
const geometry = IMAGE_EDITOR_TOOL_CONTROL_DEFINITIONS.find((item) => item.id === 'geometry')!;
const blur = IMAGE_EDITOR_TOOL_CONTROL_DEFINITIONS.find((item) => item.id === 'blur')!;
const diffusion = IMAGE_EDITOR_TOOL_CONTROL_DEFINITIONS.find((item) => item.id === 'diffusion')!;
const vgpuGlow = IMAGE_EDITOR_TOOL_CONTROL_DEFINITIONS.find((item) => item.id === 'vgpuGlow')!;

imageEditorToolRegistry.register({
  ...geometry,
  control: geometry,
  icon: ScanLine,
  inspector: GeometryInspector,
});
imageEditorToolRegistry.register({
  ...blur,
  control: blur,
  icon: Blend,
  inspector: BlurInspector,
});
imageEditorToolRegistry.register({
  ...diffusion,
  control: diffusion,
  icon: Sparkles,
  inspector: DiffusionInspector,
});
imageEditorToolRegistry.register({
  ...vgpuGlow,
  control: vgpuGlow,
  icon: ICON_IMAGE_GLOW_PRO,
  inspector: VgpuGlowInspector,
});

export function getImageEditorTools(): ImageEditorToolDefinition[] {
  return imageEditorToolRegistry.list();
}

export function getImageEditorTool(toolId: string): ImageEditorToolDefinition | null {
  return imageEditorToolRegistry.get(toolId);
}
