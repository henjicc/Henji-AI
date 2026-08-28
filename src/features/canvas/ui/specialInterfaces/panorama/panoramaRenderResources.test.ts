/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest';

import {
  PANORAMA_MAX_FOV,
  PANORAMA_MAX_PITCH,
  PANORAMA_MIN_FOV,
  clampPanoramaFov,
  clampPanoramaPitch,
  createPanoramaRenderResources,
  disposePanoramaRenderResources,
  isEquirectangularPanoramaDimensions,
} from './panoramaRenderResources';

describe('全景球面资源', () => {
  it('只接受严格 2:1 的有效像素尺寸', () => {
    expect(isEquirectangularPanoramaDimensions(2048, 1024)).toBe(true);
    expect(isEquirectangularPanoramaDimensions(2047, 1024)).toBe(false);
    expect(isEquirectangularPanoramaDimensions(0, 0)).toBe(false);
  });

  it('限制俯仰与视场角，避免翻转和过度缩放', () => {
    expect(clampPanoramaFov(1)).toBe(PANORAMA_MIN_FOV);
    expect(clampPanoramaFov(120)).toBe(PANORAMA_MAX_FOV);
    expect(clampPanoramaPitch(Math.PI)).toBe(PANORAMA_MAX_PITCH);
    expect(clampPanoramaPitch(-Math.PI)).toBe(-PANORAMA_MAX_PITCH);
  });

  it('关闭或切图时释放纹理、材质和几何体', () => {
    const resources = createPanoramaRenderResources(new Image());
    const textureDisposed = vi.fn();
    const materialDisposed = vi.fn();
    const geometryDisposed = vi.fn();
    resources.texture.addEventListener('dispose', textureDisposed);
    resources.material.addEventListener('dispose', materialDisposed);
    resources.geometry.addEventListener('dispose', geometryDisposed);

    disposePanoramaRenderResources(resources);

    expect(textureDisposed).toHaveBeenCalledOnce();
    expect(materialDisposed).toHaveBeenCalledOnce();
    expect(geometryDisposed).toHaveBeenCalledOnce();
    expect(resources.material.map).toBeNull();
  });
});
