import type { PaintBrush } from '@/core/imaging/paint';
import type { ImageEditorToolSettingsV3 } from '../../store/imageEditorSessionStoreV3';

export const PAINT_DYNAMICS_DEFAULTS: Omit<PaintBrush, 'size' | 'opacity' | 'hardness'> = {
  flow: 1, spacing: 0.15, smoothing: 0, pressureSize: true, pressureFlow: false,
  pressureCurve: 'linear', tip: 'round', angle: 0, tilt: false, texture: 0, scatter: 0, seed: 1,
};
export function imageEditPaintBrushV3(settings: ImageEditorToolSettingsV3): PaintBrush {
  return { ...settings.brushDynamics, size: settings.brushSize, opacity: settings.brushOpacity, hardness: settings.brushHardness };
}
