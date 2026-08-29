import {
  MeshBasicMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
} from 'three';
import {
  PANORAMA_INITIAL_FOV,
  PANORAMA_MAX_FOV,
  PANORAMA_MAX_PITCH,
  PANORAMA_MIN_FOV,
} from '@/features/canvas/domain/panoramaViewer';
import type { PanoramaCameraView } from '@/features/canvas/domain/panoramaViewer';

export {
  PANORAMA_INITIAL_FOV,
  PANORAMA_MAX_FOV,
  PANORAMA_MAX_PITCH,
  PANORAMA_MIN_FOV,
};

export interface PanoramaRenderResources {
  texture: Texture;
  geometry: SphereGeometry;
  material: MeshBasicMaterial;
}

export function isEquirectangularPanoramaDimensions(width: number, height: number): boolean {
  return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0
    && width === height * 2;
}

export function clampPanoramaFov(value: number): number {
  return Math.min(PANORAMA_MAX_FOV, Math.max(PANORAMA_MIN_FOV, value));
}

export function clampPanoramaPitch(value: number): number {
  return Math.min(PANORAMA_MAX_PITCH, Math.max(-PANORAMA_MAX_PITCH, value));
}

/** “抓住画面拖动”的自然方向：画面跟随指针移动，水平和垂直增量都与指针同向。 */
export function applyPanoramaDragDelta(
  view: PanoramaCameraView,
  deltaX: number,
  deltaY: number,
  sensitivity = 0.004,
): PanoramaCameraView {
  return {
    yaw: view.yaw + deltaX * sensitivity,
    pitch: clampPanoramaPitch(view.pitch + deltaY * sensitivity),
    fov: clampPanoramaFov(view.fov),
  };
}

export function createPanoramaRenderResources(image: HTMLImageElement): PanoramaRenderResources {
  const texture = new Texture(image);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;

  const geometry = new SphereGeometry(10, 64, 40);
  geometry.scale(-1, 1, 1);
  const material = new MeshBasicMaterial({ map: texture });
  return { texture, geometry, material };
}

export function disposePanoramaRenderResources(resources: PanoramaRenderResources): void {
  resources.material.map = null;
  resources.material.dispose();
  resources.geometry.dispose();
  resources.texture.dispose();
}
