import type { DiffusionPresetId } from '../diffusionPresets';
import type { DiffusionChartId } from './diffusionCharts';

export type DiffusionBaselineStatus = 'frozen' | 'pending-electron-runtime';

export interface DiffusionQualityThreshold {
  readonly id: string;
  readonly category: 'energy' | 'psf' | 'highlight' | 'black' | 'colour' | 'detail' | 'edge' | 'alpha' | 'tile' | 'fallback';
  readonly status: DiffusionBaselineStatus;
  readonly target: string;
  readonly rationale: string;
}

export interface DiffusionGoldenDefinition {
  readonly id: string;
  readonly chartId: DiffusionChartId;
  readonly presetId: DiffusionPresetId;
  readonly output: 'webgpu-preview' | 'webgpu-export' | 'sharp-fallback';
  readonly assertions: readonly string[];
}

/**
 * 程序化 Golden 的输入与断言索引；实际 WebGPU/Sharp 输出在 4.2 的真实 Electron 验收中采集。
 * 不依赖外部照片，因此没有额外数据授权或派生资产风险。
 */
export const DIFFUSION_GOLDEN_INDEX: readonly DiffusionGoldenDefinition[] = [
  { id: 'black-low-black-field', chartId: 'black-field-highlight', presetId: 'black-mist-low', output: 'webgpu-export', assertions: ['暗部不被整体抬灰', '高光边缘柔化'] },
  { id: 'black-medium-edge', chartId: 'sharp-edge', presetId: 'black-mist-medium', output: 'webgpu-preview', assertions: ['边缘无黑边', '高频保留'] },
  { id: 'black-high-noise', chartId: 'noise-detail', presetId: 'black-mist-high', output: 'webgpu-export', assertions: ['长尾散射', '细节不被完全抹除'] },
  { id: 'white-low-steps', chartId: 'luminance-steps', presetId: 'white-mist-low', output: 'webgpu-preview', assertions: ['软阈值连续', '轻微雾幕'] },
  { id: 'white-medium-colour', chartId: 'colour-patches', presetId: 'white-mist-medium', output: 'webgpu-export', assertions: ['散射去饱和受控', '色相不跳变'] },
  { id: 'white-high-alpha', chartId: 'transparent-edge', presetId: 'white-mist-high', output: 'webgpu-export', assertions: ['透明边缘无暗边', 'Alpha 保留'] },
  { id: 'glow-low-point', chartId: 'single-point-light', presetId: 'glow-low', output: 'webgpu-preview', assertions: ['PSF 径向连续', '高光不凭空削顶'] },
  { id: 'glow-medium-double-point', chartId: 'double-point-light', presetId: 'glow-medium', output: 'webgpu-export', assertions: ['双高光叠加连续', '无中心硬阈值'] },
  { id: 'glow-high-tile', chartId: 'single-point-light', presetId: 'glow-high', output: 'webgpu-export', assertions: ['Tile 接缝不可见', '长尾能量稳定'] },
];

export const DIFFUSION_QUALITY_THRESHOLDS: readonly DiffusionQualityThreshold[] = [
  { id: 'recipe-energy-conservation', category: 'energy', status: 'frozen', target: 'directRetention + scatterFraction 的绝对误差 ≤ 1e-12', rationale: '共享配方是所有执行器的唯一能量契约，可在纯核心测试中稳定验证。' },
  { id: 'webgpu-psf-radial', category: 'psf', status: 'pending-electron-runtime', target: '单点光源归一化径向曲线非递增，采样 RMSE ≤ 0.04', rationale: '需由正式 WGSL 输出采样，不能用第一阶段线性原型替代。' },
  { id: 'webgpu-highlight-peak', category: 'highlight', status: 'pending-electron-runtime', target: '高光峰值相对输入的增量 ≤ 2%，且无单像素硬阈值跳变', rationale: '防止散射合成凭空制造峰值，需在真实 GPU 输出中测量。' },
  { id: 'webgpu-black-mist', category: 'black', status: 'pending-electron-runtime', target: '黑柔中等预设的暗区提升低于白柔中等预设，差值 ≥ 1/255', rationale: '确保两种模式在黑位和雾幕上可区分。' },
  { id: 'webgpu-colour-delta', category: 'colour', status: 'pending-electron-runtime', target: '彩色色块非散射区域 ΔE00 ≤ 3，散射区域仅允许按预设去饱和', rationale: '避免色相漂移，同时保留可控的散射去饱和。' },
  { id: 'webgpu-detail-retention', category: 'detail', status: 'pending-electron-runtime', target: '中等预设锐边局部对比保留 ≥ 80%', rationale: '保证柔光不是无差别全图模糊。' },
  { id: 'webgpu-edge-and-alpha', category: 'alpha', status: 'pending-electron-runtime', target: '锐边与透明边缘不存在可见黑边；Alpha 通道逐像素保持不变', rationale: '导出合成与预乘处理必须经真实 Electron 验证。' },
  { id: 'webgpu-tile-seam', category: 'tile', status: 'pending-electron-runtime', target: '1536/64 Tile 交界处 RGBA 最大差 ≤ 1/255', rationale: '正式多尺度 WGSL 需要重新验证，不能沿用线性基线结论。' },
  { id: 'sharp-perceptual-tolerance', category: 'fallback', status: 'pending-electron-runtime', target: '支持参数的纯柔光图与 WebGPU 对比 SSIM ≥ 0.92，平均 ΔE00 ≤ 6', rationale: 'Sharp 是兼容降级，不要求位级一致但必须避免明显偏色或结构损失。' },
];

export function validateDiffusionBaselineDefinitions(): readonly string[] {
  const issues: string[] = [];
  const goldenIds = new Set<string>();
  const coveredPresets = new Set<DiffusionPresetId>();
  for (const golden of DIFFUSION_GOLDEN_INDEX) {
    if (goldenIds.has(golden.id)) issues.push(`重复 Golden ID：${golden.id}`);
    goldenIds.add(golden.id);
    coveredPresets.add(golden.presetId);
  }
  if (coveredPresets.size !== 9) issues.push('Golden 必须覆盖九个通用预设');
  if (!DIFFUSION_QUALITY_THRESHOLDS.some((threshold) => threshold.status === 'frozen')) {
    issues.push('至少需要一个已冻结的数值阈值');
  }
  if (!DIFFUSION_QUALITY_THRESHOLDS.some((threshold) => threshold.status === 'pending-electron-runtime')) {
    issues.push('需要显式列出待真实 Electron 验证的阈值');
  }
  return issues;
}
