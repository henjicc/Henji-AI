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

export const DIFFUSION_DENSITY_OPTIONS: readonly DiffusionSelectOption<DiffusionDensity>[] = [
  { value: '1/8', label: '1/8' },
  { value: '1/4', label: '1/4' },
  { value: '1/2', label: '1/2' },
  { value: '1', label: '1' },
];

export const DIFFUSION_QUALITY_OPTIONS: readonly DiffusionSelectOption<DiffusionQuality>[] = [
  { value: 'realtime', label: '实时预览' },
  { value: 'high', label: '高质量导出' },
];

export function formatDiffusionPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function formatDiffusionRadius(value: number): string {
  return `${(value * 100).toFixed(value < 0.01 ? 1 : 0)}%`;
}

export function formatDiffusionNumber(value: number, digits = 2): string {
  return value.toFixed(digits).replace(/\.0+$/, '');
}
