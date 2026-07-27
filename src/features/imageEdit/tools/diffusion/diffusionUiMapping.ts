import type { DiffusionDensity, DiffusionMode, DiffusionQuality } from '@/core/imageEdit';

export interface DiffusionSelectOption<T extends string> {
  value: T;
  label: string;
}

export const DIFFUSION_MODE_OPTIONS: readonly DiffusionSelectOption<DiffusionMode>[] = [
  { value: 'black_mist', label: '黑柔' },
  { value: 'white_mist', label: '白柔' },
  { value: 'glow', label: '辉光' },
];

/**
 * 档位在摄影里按滤镜密度写成 1/8、1/4、1/2，纯辉光没有这个传统，所以按模式换词表。
 * 底层存的都是 low/medium/high，只是显示不同。
 */
const MIST_DENSITY_LABELS: Record<DiffusionDensity, string> = {
  low: '1/8',
  medium: '1/4',
  high: '1/2',
};

const GLOW_DENSITY_LABELS: Record<DiffusionDensity, string> = {
  low: '弱',
  medium: '中',
  high: '强',
};

const DENSITY_ORDER: readonly DiffusionDensity[] = ['low', 'medium', 'high'];

export function getDiffusionDensityOptions(
  mode: DiffusionMode
): readonly DiffusionSelectOption<DiffusionDensity>[] {
  const labels = mode === 'glow' ? GLOW_DENSITY_LABELS : MIST_DENSITY_LABELS;
  return DENSITY_ORDER.map((value) => ({ value, label: labels[value] }));
}

export const DIFFUSION_QUALITY_OPTIONS: readonly DiffusionSelectOption<DiffusionQuality>[] = [
  { value: 'realtime', label: '实时预览' },
  { value: 'high', label: '高质量导出' },
];

export function formatDiffusionPercent(value: number): string {
  return `${Math.round(value * 100)}`;
}

export function formatDiffusionSigned(value: number): string {
  const scaled = Math.round(value * 100);
  return scaled > 0 ? `+${scaled}` : `${scaled}`;
}

export function formatDiffusionDegrees(value: number): string {
  return `${Math.round(value)}°`;
}
