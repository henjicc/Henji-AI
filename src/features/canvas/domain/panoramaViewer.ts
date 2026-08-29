export const PANORAMA_VIEW_MODES = ['sphere', 'flat'] as const;
export type PanoramaViewMode = (typeof PANORAMA_VIEW_MODES)[number];

export const PANORAMA_VIEWPORT_ASPECT_RATIOS = [
  '21:9',
  '16:9',
  '3:2',
  '4:3',
  '1:1',
] as const;
export type PanoramaViewportAspectRatio = (typeof PANORAMA_VIEWPORT_ASPECT_RATIOS)[number];

export interface PanoramaCameraView {
  yaw: number;
  pitch: number;
  fov: number;
}

export const PANORAMA_INITIAL_FOV = 70;
export const PANORAMA_MIN_FOV = 30;
export const PANORAMA_MAX_FOV = 90;
export const PANORAMA_MAX_PITCH = Math.PI * 0.47;
export const PANORAMA_DEFAULT_VIEW_MODE: PanoramaViewMode = 'sphere';
export const PANORAMA_DEFAULT_VIEWPORT_ASPECT_RATIO: PanoramaViewportAspectRatio = '16:9';
export const PANORAMA_DEFAULT_CAMERA_VIEW: Readonly<PanoramaCameraView> = {
  yaw: 0,
  pitch: 0,
  fov: 70,
};

export function normalizePanoramaViewMode(value: unknown): PanoramaViewMode {
  return value === 'flat' ? 'flat' : PANORAMA_DEFAULT_VIEW_MODE;
}

export function normalizePanoramaViewportAspectRatio(
  value: unknown,
): PanoramaViewportAspectRatio {
  return typeof value === 'string'
    && (PANORAMA_VIEWPORT_ASPECT_RATIOS as readonly string[]).includes(value)
    ? value as PanoramaViewportAspectRatio
    : PANORAMA_DEFAULT_VIEWPORT_ASPECT_RATIO;
}

export function parsePanoramaViewportAspectRatio(value: PanoramaViewportAspectRatio): number {
  const [width, height] = value.split(':').map(Number);
  return width / height;
}

export function resolvePanoramaCaptureSize(
  value: PanoramaViewportAspectRatio,
  shortEdge = 720,
): { width: number; height: number } {
  const ratio = parsePanoramaViewportAspectRatio(value);
  const safeShortEdge = Math.max(2, Math.round(shortEdge));
  return ratio >= 1
    ? { width: Math.max(2, Math.round(safeShortEdge * ratio)), height: safeShortEdge }
    : { width: safeShortEdge, height: Math.max(2, Math.round(safeShortEdge / ratio)) };
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function normalizePanoramaCameraView(value: unknown): PanoramaCameraView {
  const candidate = value && typeof value === 'object'
    ? value as Partial<PanoramaCameraView>
    : {};
  const pitch = finiteOr(candidate.pitch, PANORAMA_DEFAULT_CAMERA_VIEW.pitch);
  const fov = finiteOr(candidate.fov, PANORAMA_DEFAULT_CAMERA_VIEW.fov);
  return {
    yaw: finiteOr(candidate.yaw, PANORAMA_DEFAULT_CAMERA_VIEW.yaw),
    pitch: Math.min(PANORAMA_MAX_PITCH, Math.max(-PANORAMA_MAX_PITCH, pitch)),
    fov: Math.min(PANORAMA_MAX_FOV, Math.max(PANORAMA_MIN_FOV, fov)),
  };
}
