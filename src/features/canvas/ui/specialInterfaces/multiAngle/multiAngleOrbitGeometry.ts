import { MULTI_ANGLE_DISCRETE_VIEW_PRESETS, type MultiAngleViewV1, type MultiAngleDiscretePreset } from '@/features/canvas/capabilities/multiAnglePolicy'

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
  if (view.kind === 'continuous') return { azimuth: -view.yawControlDeg, elevation: view.elevationDeg }
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

/** Test the ray from a world-space marker toward the viewer against the actual image block. */
function occludedByBlock(point: Point3, towardCamera: Point3, halfSize: Point3): boolean {
  let enter = 0
  let leave = Infinity
  for (let axis = 0; axis < 3; axis++) {
    const direction = towardCamera[axis]
    if (Math.abs(direction) < 0.000001) {
      if (Math.abs(point[axis]) > halfSize[axis]) return false
      continue
    }
    const a = (-halfSize[axis] - point[axis]) / direction
    const b = (halfSize[axis] - point[axis]) / direction
    enter = Math.max(enter, Math.min(a, b))
    leave = Math.min(leave, Math.max(a, b))
    if (leave < enter) return false
  }
  return leave > 0.000001
}

export function multiAngleDirectionGeometry(
  block: { width: number; height: number; depth: number },
  pose: MultiAngleOrientation,
) {
  const towardCamera = orientationVector(pose)
  const points = MULTI_ANGLE_DISCRETE_VIEW_PRESETS.map(({ view }) => {
    const vector = orientationVector(multiAngleOrientation(view))
    const point: Point3 = [vector[0] * 43, vector[1] * 43, vector[2] * 43]
    const [x, y, depth] = rotateImageBlock(point, pose)
    return { view, x: 50 + x, y: 50 - y, depth,
      size: 2.1 + depth / 100,
      opacity: 0.65 + depth / 140,
      occluded: occludedByBlock(point, towardCamera, [block.width / 2, block.height / 2, block.depth / 2]),
    }
  }).sort((a, b) => a.depth - b.depth)
  // Antipodal markers can project to the same spot. Only the nearer sphere is actionable.
  return points.map(point => ({ ...point, occluded: point.occluded || points.some(other =>
    !other.occluded && other.depth > point.depth + 0.000001
      && Math.hypot(other.x - point.x, other.y - point.y) < other.size / 2) }))
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
  return { width, height, depth, faces, matrix: `matrix(${(right[0] - origin[0]) / width} ${(right[1] - origin[1]) / width} ${(bottom[0] - origin[0]) / height} ${(bottom[1] - origin[1]) / height} ${origin[0]} ${origin[1]})` }
}
