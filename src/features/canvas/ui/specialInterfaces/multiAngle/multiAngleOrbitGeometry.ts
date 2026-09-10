import type { MultiAngleViewV1, MultiAngleDiscretePreset } from '@/features/canvas/capabilities/multiAnglePolicy'

export interface MultiAngleOrientation { azimuth: number; elevation: number }
export type ImageBlockFace = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom'
type Point3 = readonly [number, number, number]

const PRESET_ORIENTATIONS: Record<MultiAngleDiscretePreset, MultiAngleOrientation> = {
  front: { azimuth: 0, elevation: 0 }, left_side: { azimuth: -90, elevation: 0 },
  right_side: { azimuth: 90, elevation: 0 }, back: { azimuth: 180, elevation: 0 },
  top_down: { azimuth: 0, elevation: 90 }, bottom_up: { azimuth: 0, elevation: -90 },
  birds_eye: { azimuth: -30, elevation: 60 },
  three_quarter_left: { azimuth: -45, elevation: 0 }, three_quarter_right: { azimuth: 45, elevation: 0 },
}

/** Camera direction in source-image space: +Z is the source front, +Y is above. */
export function multiAngleOrientation(view: MultiAngleViewV1): MultiAngleOrientation {
  if (view.kind === 'continuous') return { azimuth: -view.yawControlDeg, elevation: -view.verticalControl * 45 }
  if (view.kind === 'flux') return { azimuth: view.horizontalAngleDeg, elevation: view.verticalAngleDeg }
  return PRESET_ORIENTATIONS[view.preset]
}

export function orientationVector(pose: MultiAngleOrientation): Point3 {
  const yaw = pose.azimuth * Math.PI / 180; const pitch = pose.elevation * Math.PI / 180
  return [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)]
}

/** Inverse camera rotation makes the visible image-block face match the requested view. */
export function rotateImageBlock(point: Point3, pose: MultiAngleOrientation): Point3 {
  const yaw = pose.azimuth * Math.PI / 180; const pitch = pose.elevation * Math.PI / 180
  const x = Math.cos(yaw) * point[0] - Math.sin(yaw) * point[2]
  const z = Math.sin(yaw) * point[0] + Math.cos(yaw) * point[2]
  return [x, Math.cos(pitch) * point[1] - Math.sin(pitch) * z,
    Math.sin(pitch) * point[1] + Math.cos(pitch) * z]
}

export function imageBlockGeometry(aspect: number, pose: MultiAngleOrientation, zoom = 5) {
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 1
  const extent = 64 + Math.max(0, Math.min(10, zoom)) * 0.8
  const width = Math.min(extent, extent * ratio); const height = Math.min(extent, extent / ratio)
  const depth = Math.min(width, height) * 0.5
  const x = width / 2; const y = height / 2; const z = depth / 2
  const project = (p: Point3): Point3 => { const r = rotateImageBlock(p, pose); return [50 + r[0], 50 - r[1], r[2]] }
  const definitions: { name: ImageBlockFace; normal: Point3; corners: Point3[] }[] = [
    { name: 'front', normal: [0, 0, 1], corners: [[-x, y, z], [x, y, z], [x, -y, z], [-x, -y, z]] },
    { name: 'back', normal: [0, 0, -1], corners: [[x, y, -z], [-x, y, -z], [-x, -y, -z], [x, -y, -z]] },
    { name: 'left', normal: [-1, 0, 0], corners: [[-x, y, -z], [-x, y, z], [-x, -y, z], [-x, -y, -z]] },
    { name: 'right', normal: [1, 0, 0], corners: [[x, y, z], [x, y, -z], [x, -y, -z], [x, -y, z]] },
    { name: 'top', normal: [0, 1, 0], corners: [[-x, y, -z], [x, y, -z], [x, y, z], [-x, y, z]] },
    { name: 'bottom', normal: [0, -1, 0], corners: [[-x, -y, z], [x, -y, z], [x, -y, -z], [-x, -y, -z]] },
  ]
  const faces = definitions.map(face => {
    const points = face.corners.map(project)
    return { name: face.name, visible: rotateImageBlock(face.normal, pose)[2] > 0.00001,
      depth: points.reduce((sum, p) => sum + p[2], 0) / 4,
      textureMatrix: `matrix(${points[1][0] - points[0][0]} ${points[1][1] - points[0][1]} ${points[3][0] - points[0][0]} ${points[3][1] - points[0][1]} ${points[0][0]} ${points[0][1]})`,
      points: points.map(p => `${p[0]},${p[1]}`).join(' ') }
  }).sort((a, b) => a.depth - b.depth)
  const origin = project([-x, y, z]); const right = project([x, y, z]); const bottom = project([-x, -y, z])
  return { width, height, faces, matrix: `matrix(${(right[0] - origin[0]) / width} ${(right[1] - origin[1]) / width} ${(bottom[0] - origin[0]) / height} ${(bottom[1] - origin[1]) / height} ${origin[0]} ${origin[1]})` }
}
