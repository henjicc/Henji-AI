import { describe, expect, it } from 'vitest';
import {
  DIFFUSION_QUALITY_CHARTS,
  listDiffusionQualityCharts,
  renderDiffusionQualityChart,
} from './diffusionCharts';

describe('摄影柔光程序化质量测试图', () => {
  it('覆盖能量、PSF、边缘、色彩、透明和细节输入', () => {
    expect(listDiffusionQualityCharts()).toHaveLength(8);
    expect(new Set(DIFFUSION_QUALITY_CHARTS.map((chart) => chart.id)).size).toBe(8);
    const coverage = DIFFUSION_QUALITY_CHARTS.flatMap((chart) => chart.coverage).join(' ');
    expect(coverage).toContain('能量');
    expect(coverage).toContain('PSF');
    expect(coverage).toContain('边缘');
    expect(coverage).toContain('透明');
    expect(coverage).toContain('色彩');
    expect(coverage).toContain('细节');
  });

  it('为每张图生成确定的小尺寸 RGBA 基线', () => {
    for (const chart of DIFFUSION_QUALITY_CHARTS) {
      const rendered = renderDiffusionQualityChart(chart.id);
      expect(rendered.pixels).toHaveLength(chart.width * chart.height * 4);
      expect(rendered.pixels.some((value) => value > 0)).toBe(true);
    }
  });

  it('透明边缘保留透明和不透明两个端点', () => {
    const rendered = renderDiffusionQualityChart('transparent-edge');
    expect(rendered.pixels[3]).toBe(0);
    expect(rendered.pixels[rendered.pixels.length - 1]).toBe(255);
  });
});
