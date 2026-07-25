/** 仅用于自动化质量基线的小尺寸程序化 RGBA 图，不进入图片编辑运行时路径。 */

export type DiffusionChartId =
  | 'single-point-light'
  | 'double-point-light'
  | 'luminance-steps'
  | 'black-field-highlight'
  | 'colour-patches'
  | 'sharp-edge'
  | 'transparent-edge'
  | 'noise-detail';

export interface DiffusionChartDefinition {
  readonly id: DiffusionChartId;
  readonly title: string;
  readonly coverage: readonly string[];
  readonly width: number;
  readonly height: number;
}

export interface DiffusionChartRaster {
  readonly chart: DiffusionChartDefinition;
  readonly pixels: Uint8ClampedArray;
}

const CHART_WIDTH = 96;
const CHART_HEIGHT = 64;

export const DIFFUSION_QUALITY_CHARTS: readonly DiffusionChartDefinition[] = [
  { id: 'single-point-light', title: '单点光源', coverage: ['PSF 径向曲线', '高光峰值', '能量'], width: CHART_WIDTH, height: CHART_HEIGHT },
  { id: 'double-point-light', title: '双点光源', coverage: ['相邻高光', '能量叠加'], width: CHART_WIDTH, height: CHART_HEIGHT },
  { id: 'luminance-steps', title: '亮度阶梯', coverage: ['软阈值', '黑位', '高光过渡'], width: CHART_WIDTH, height: CHART_HEIGHT },
  { id: 'black-field-highlight', title: '黑底高光', coverage: ['黑位提升', '长尾散射'], width: CHART_WIDTH, height: CHART_HEIGHT },
  { id: 'colour-patches', title: '彩色色块', coverage: ['色彩偏移', '散射去饱和'], width: CHART_WIDTH, height: CHART_HEIGHT },
  { id: 'sharp-edge', title: '锐利边缘', coverage: ['细节保留', '边缘无黑边'], width: CHART_WIDTH, height: CHART_HEIGHT },
  { id: 'transparent-edge', title: '透明边缘', coverage: ['Alpha 合成', '透明边缘'], width: CHART_WIDTH, height: CHART_HEIGHT },
  { id: 'noise-detail', title: '噪声细节', coverage: ['微扩散', '高频细节'], width: CHART_WIDTH, height: CHART_HEIGHT },
];

export function listDiffusionQualityCharts(): readonly DiffusionChartDefinition[] {
  return DIFFUSION_QUALITY_CHARTS;
}

export function renderDiffusionQualityChart(chartId: DiffusionChartId): DiffusionChartRaster {
  const chart = DIFFUSION_QUALITY_CHARTS.find((candidate) => candidate.id === chartId);
  if (!chart) throw new Error(`未知柔光质量测试图：${chartId}`);
  const pixels = new Uint8ClampedArray(chart.width * chart.height * 4);
  for (let y = 0; y < chart.height; y += 1) {
    for (let x = 0; x < chart.width; x += 1) {
      const offset = (y * chart.width + x) * 4;
      const rgba = sampleChartPixel(chart.id, x, y, chart.width, chart.height);
      pixels[offset] = rgba[0];
      pixels[offset + 1] = rgba[1];
      pixels[offset + 2] = rgba[2];
      pixels[offset + 3] = rgba[3];
    }
  }
  return { chart, pixels };
}

function sampleChartPixel(
  chartId: DiffusionChartId,
  x: number,
  y: number,
  width: number,
  height: number
): readonly [number, number, number, number] {
  switch (chartId) {
    case 'single-point-light': return pointLight(x, y, width * 0.5, height * 0.5);
    case 'double-point-light': return addLights([
      pointLight(x, y, width * 0.31, height * 0.45),
      pointLight(x, y, width * 0.69, height * 0.55),
    ]);
    case 'luminance-steps': return luminanceSteps(x, width);
    case 'black-field-highlight': return pointLight(x, y, width * 0.5, height * 0.5, 0.14);
    case 'colour-patches': return colourPatches(x, y, width, height);
    case 'sharp-edge': return sharpEdge(x, width);
    case 'transparent-edge': return transparentEdge(x, width);
    case 'noise-detail': return noiseDetail(x, y);
  }
}

function pointLight(
  x: number,
  y: number,
  centerX: number,
  centerY: number,
  floor = 0
): readonly [number, number, number, number] {
  const distance = Math.hypot(x - centerX, y - centerY);
  const value = floor + (1 - floor) * Math.exp(-(distance * distance) / 30);
  const channel = toByte(value);
  return [channel, channel, channel, 255];
}

function addLights(lights: readonly (readonly [number, number, number, number])[]): readonly [number, number, number, number] {
  return [
    toByte(lights.reduce((sum, light) => sum + light[0] / 255, 0)),
    toByte(lights.reduce((sum, light) => sum + light[1] / 255, 0)),
    toByte(lights.reduce((sum, light) => sum + light[2] / 255, 0)),
    255,
  ];
}

function luminanceSteps(x: number, width: number): readonly [number, number, number, number] {
  const level = Math.floor((x / width) * 8) / 7;
  const channel = toByte(level);
  return [channel, channel, channel, 255];
}

function colourPatches(x: number, y: number, width: number, height: number): readonly [number, number, number, number] {
  const column = Math.min(3, Math.floor((x / width) * 4));
  const row = Math.min(1, Math.floor((y / height) * 2));
  const colours: readonly (readonly [number, number, number])[] = [
    [255, 48, 48], [48, 255, 96], [48, 112, 255], [255, 220, 48],
    [255, 72, 196], [48, 224, 230], [176, 88, 255], [220, 220, 220],
  ];
  const colour = colours[row * 4 + column];
  return [colour[0], colour[1], colour[2], 255];
}

function sharpEdge(x: number, width: number): readonly [number, number, number, number] {
  const channel = x < width / 2 ? 16 : 240;
  return [channel, channel, channel, 255];
}

function transparentEdge(x: number, width: number): readonly [number, number, number, number] {
  const alpha = toByte(x / (width - 1));
  return [232, 160, 48, alpha];
}

function noiseDetail(x: number, y: number): readonly [number, number, number, number] {
  const noise = ((x * 73 + y * 151 + x * y * 19) % 31) / 30;
  const channel = toByte(0.2 + noise * 0.6);
  return [channel, channel, channel, 255];
}

function toByte(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 255);
}
