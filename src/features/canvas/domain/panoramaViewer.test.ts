import { describe, expect, it } from 'vitest';

import {
  PANORAMA_DEFAULT_CAMERA_VIEW,
  PANORAMA_MAX_FOV,
  PANORAMA_MAX_PITCH,
  PANORAMA_MIN_FOV,
  normalizePanoramaCameraView,
  normalizePanoramaViewMode,
  normalizePanoramaViewportAspectRatio,
  parsePanoramaViewportAspectRatio,
  resolvePanoramaCaptureSize,
} from './panoramaViewer';

describe('全景查看领域规则', () => {
  it('只接受注册的显示模式和视口比例', () => {
    expect(normalizePanoramaViewMode('flat')).toBe('flat');
    expect(normalizePanoramaViewMode('sphere')).toBe('sphere');
    expect(normalizePanoramaViewMode('unknown')).toBe('sphere');

    expect(normalizePanoramaViewportAspectRatio('21:9')).toBe('21:9');
    expect(normalizePanoramaViewportAspectRatio('9:16')).toBe('16:9');
    expect(normalizePanoramaViewportAspectRatio('2:1')).toBe('16:9');
    expect(normalizePanoramaViewportAspectRatio(null)).toBe('16:9');
  });

  it('将所有可选视口比例解析为稳定数值', () => {
    expect(parsePanoramaViewportAspectRatio('21:9')).toBeCloseTo(21 / 9);
    expect(parsePanoramaViewportAspectRatio('16:9')).toBeCloseTo(16 / 9);
    expect(parsePanoramaViewportAspectRatio('3:2')).toBeCloseTo(3 / 2);
    expect(parsePanoramaViewportAspectRatio('4:3')).toBeCloseTo(4 / 3);
    expect(parsePanoramaViewportAspectRatio('1:1')).toBe(1);
  });

  it('以 720 像素短边导出对应视口比例的稳定截图尺寸', () => {
    expect(resolvePanoramaCaptureSize('21:9')).toEqual({ width: 1_680, height: 720 });
    expect(resolvePanoramaCaptureSize('16:9')).toEqual({ width: 1_280, height: 720 });
    expect(resolvePanoramaCaptureSize('3:2')).toEqual({ width: 1_080, height: 720 });
    expect(resolvePanoramaCaptureSize('4:3')).toEqual({ width: 960, height: 720 });
    expect(resolvePanoramaCaptureSize('1:1')).toEqual({ width: 720, height: 720 });
  });

  it('自定义短边会完数化并设有最小像素保护', () => {
    expect(resolvePanoramaCaptureSize('16:9', 101.4)).toEqual({ width: 180, height: 101 });
    expect(resolvePanoramaCaptureSize('1:1', 0)).toEqual({ width: 2, height: 2 });
  });

  it('异常相机数据恢复默认值，合法数据仅限制俯仰与视场角', () => {
    expect(normalizePanoramaCameraView(null)).toEqual(PANORAMA_DEFAULT_CAMERA_VIEW);
    expect(normalizePanoramaCameraView({
      yaw: Number.NaN,
      pitch: Number.POSITIVE_INFINITY,
      fov: '70',
    })).toEqual(PANORAMA_DEFAULT_CAMERA_VIEW);

    expect(normalizePanoramaCameraView({
      yaw: 12,
      pitch: Math.PI,
      fov: 120,
    })).toEqual({
      yaw: 12,
      pitch: PANORAMA_MAX_PITCH,
      fov: PANORAMA_MAX_FOV,
    });
    expect(normalizePanoramaCameraView({
      yaw: -12,
      pitch: -Math.PI,
      fov: 1,
    })).toEqual({
      yaw: -12,
      pitch: -PANORAMA_MAX_PITCH,
      fov: PANORAMA_MIN_FOV,
    });
  });
});
