/** 摄像机光学参数换算。内部保留 three.js 垂直 FOV，界面展示全画幅等效焦距。 */

const FULL_FRAME_SENSOR_HEIGHT_MM = 24

export function fovToFocalLength(fovDegrees: number): number {
  const safeFov = Math.min(179, Math.max(1, fovDegrees))
  return FULL_FRAME_SENSOR_HEIGHT_MM / (2 * Math.tan((safeFov * Math.PI) / 360))
}

export function focalLengthToFov(focalLengthMm: number): number {
  const safeFocalLength = Math.max(1, focalLengthMm)
  return (2 * Math.atan(FULL_FRAME_SENSOR_HEIGHT_MM / (2 * safeFocalLength)) * 180) / Math.PI
}
