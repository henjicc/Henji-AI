import {
  MeshBasicMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
} from 'three';

export const PANORAMA_INITIAL_FOV = 70;
export const PANORAMA_MIN_FOV = 30;
export const PANORAMA_MAX_FOV = 90;
export const PANORAMA_MAX_PITCH = Math.PI * 0.47;

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
