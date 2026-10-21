import { describe, expect, it } from 'vitest'
import { videoEditClipToFrame } from './clipGeometry'
import { applyVideoEditSimilarity, fitVideoEditSimilarity, ransacVideoEditSimilarity, videoEditPointPose, videoEditQuadPose, videoEditTrackPoseOnFrame, type VideoEditPoint, type VideoEditSimilarity } from './trackTransform'
import { videoEditClipFollowSchema, videoEditFollowBinding, videoEditFollowPlacement, videoEditTrackerFollowAbilities, type VideoEditTrackBox } from './tracking'

const aspect = 16 / 9
const truth: VideoEditSimilarity = { a: 1.2 * Math.cos(0.3), b: 1.2 * Math.sin(0.3), tx: 0.05, ty: -0.02 }
/** 归一化画面点经真实相似变换（各向同性坐标）后的位置。 */
const move = ([u, v]: VideoEditPoint, s: VideoEditSimilarity = truth): [number, number] => { const [x, y] = applyVideoEditSimilarity(s, u * aspect, v); return [x / aspect, y] }

describe('相似变换求解', () => {
  it('两点：长度与角度精确给出缩放与旋转', () => {
    const reference: VideoEditPoint[] = [[0.3, 0.4], [0.6, 0.5]]
    const pose = videoEditPointPose(reference, reference.map(p => [...move(p), 1] as [number, number, number]), aspect)!
    expect(pose.angle).toBeCloseTo(0.3, 9)
    const length = Math.hypot((0.6 - 0.3) * aspect, 0.1)
    expect(pose.size).toBeCloseTo(length * 1.2, 9)
    const center = move([0.45, 0.45])
    expect(pose.anchor[0]).toBeCloseTo(center[0], 9); expect(pose.anchor[1]).toBeCloseTo(center[1], 9)
  })

  it('两点中任一点跟丢：求不出姿态', () => {
    expect(videoEditPointPose([[0.3, 0.4], [0.6, 0.5]], [[0.31, 0.4, 1], [0.6, 0.5, 0]], aspect)).toBeUndefined()
  })

  it('三、四点：一个点漂移时剔除离群点，按剩下的点精确求解', () => {
    const reference: VideoEditPoint[] = [[0.2, 0.2], [0.7, 0.25], [0.65, 0.7], [0.25, 0.75]]
    const current = reference.map(p => [...move(p), 1] as [number, number, number])
    current[2] = [current[2][0] + 0.08, current[2][1] - 0.05, 1]
    const pose = videoEditPointPose(reference, current, aspect)!
    expect(pose.angle).toBeCloseTo(0.3, 6)
    expect(pose.size! / videoEditPointPose(reference, reference.map(p => [p[0], p[1], 1] as [number, number, number]), aspect)!.size!).toBeCloseTo(1.2, 6)
  })

  it('四点按可信度加权：跟丢的点不参与', () => {
    const reference: VideoEditPoint[] = [[0.2, 0.2], [0.7, 0.25], [0.65, 0.7], [0.25, 0.75]]
    const current = reference.map(p => [...move(p), 1] as [number, number, number])
    current[0] = [0.9, 0.9, 0]
    expect(videoEditPointPose(reference, current, aspect)!.angle).toBeCloseTo(0.3, 9)
  })

  it('平面四角：相似变换给出旋转与缩放', () => {
    const quad: VideoEditPoint[] = [[0.3, 0.3], [0.6, 0.3], [0.6, 0.6], [0.3, 0.6]]
    const pose = videoEditQuadPose(quad, quad.map(p => move(p)), aspect, 0.9)!
    expect(pose.angle).toBeCloseTo(0.3, 9); expect(pose.confidence).toBe(0.9)
  })

  it('RANSAC：三成前景点乱动，背景运动仍精确', () => {
    const src: VideoEditPoint[] = []; const dst: VideoEditPoint[] = []
    for (let i = 0; i < 200; i++) {
      const p: VideoEditPoint = [((i * 37) % 100) / 100 * aspect - aspect / 2, ((i * 53) % 100) / 100 - 0.5]
      src.push(p)
      dst.push(i % 10 < 3 ? [p[0] + 0.05 + (i % 7) * 0.01, p[1] - 0.03] : applyVideoEditSimilarity(truth, p[0], p[1]))
    }
    const fit = ransacVideoEditSimilarity(src, dst, { threshold: 0.002 })!
    expect(fit.ratio).toBeCloseTo(0.7, 1)
    for (const key of ['a', 'b', 'tx', 'ty'] as const) expect(fit.similarity[key]).toBeCloseTo(truth[key], 9)
    expect(fitVideoEditSimilarity([[0, 0]], [[1, 1]])).toBeUndefined()
  })
})

describe('跟随叠加', () => {
  const picture = { width: 1920, height: 1080 }; const frame = { width: 1920, height: 1080 }
  const target = { x: 0, y: 0, scale: 1, rotation: 0, anchorX: 0.5, anchorY: 0.5 }
  const reference: VideoEditPoint[] = [[0.4, 0.5], [0.6, 0.5]]
  const box: VideoEditTrackBox = [0.4, 0.49, 0.2, 0.02, 1]

  it('两点跟踪：元素绕跟踪点转动并缩放，旋转随跟踪增加', () => {
    const at = (s: VideoEditSimilarity) => ({ box, pose: videoEditPointPose(reference, reference.map(p => [...move(p, s), 1] as [number, number, number]), aspect)! })
    const identity = { a: 1, b: 0, tx: 0, ty: 0 }
    const label = { x: 0.1, y: -0.1, scale: 0.5, rotation: 10 }
    const follow = videoEditFollowBinding(label, { clipId: 'shot', trackerId: 't', placement: target, picture }, frame, at(identity), { rotation: true, scale: true })
    expect(videoEditClipFollowSchema.parse(follow)).toEqual(follow)
    // 绑定帧不动。
    const still = videoEditFollowPlacement(follow, label, target, picture, frame, at(identity))
    expect(still.x).toBeCloseTo(0.1, 5); expect(still.y).toBeCloseTo(-0.1, 5); expect(still.rotation).toBeCloseTo(10, 4); expect(still.scale).toBeCloseTo(0.5, 4)
    // 跟踪绕画面中心转 90°、放大 2 倍：偏移随之转动缩放。
    const c = [aspect / 2, 0.5]; const spin = { a: 0, b: 2, tx: c[0] + 2 * c[1], ty: c[1] - 2 * c[0] }
    const moved = videoEditFollowPlacement(follow, label, target, picture, frame, at(spin))
    expect(moved.rotation).toBeCloseTo(100, 4); expect(moved.scale).toBeCloseTo(1, 4); expect(moved.trackingRotation).toBeCloseTo(90, 4)
    // 偏移 (0.1·W, −0.1·H) 像素，绕中心转 90° 放大 2 倍 → (0.2·H, 0.2·W) 像素。
    expect(moved.x * frame.width).toBeCloseTo(0.2 * frame.height, 1); expect(moved.y * frame.height).toBeCloseTo(0.2 * frame.width, 1)
  })

  it('跟踪的片段自己旋转时，跟随角度换到序列画面', () => {
    const rotated = { ...target, rotation: 30 }
    const pose = videoEditPointPose(reference, reference.map(p => [p[0], p[1], 1] as [number, number, number]), aspect)!
    expect(videoEditTrackPoseOnFrame(rotated, picture, frame, pose).angle).toBeCloseTo(30, 6)
    const on = videoEditTrackPoseOnFrame(rotated, picture, frame, pose)
    const center = videoEditClipToFrame(rotated, picture, frame, 0.5, 0.5)
    expect(on.x).toBeCloseTo(center.x, 9)
  })

  it('旧的位置跟随（无 motion）行为不变：偏移不随框缩放', () => {
    const legacy = { clipId: 'shot', trackerId: 't', offsetX: 0.1, offsetY: 0, scaleReference: 0.1 }
    const grown: VideoEditTrackBox = [0.3, 0.4, 0.4, 0.2, 1]
    const placed = videoEditFollowPlacement(legacy, { scale: 1, rotation: 5 }, target, picture, frame, { box: grown })
    expect(placed.x).toBeCloseTo(0.1, 9); expect(placed.rotation).toBe(5)
  })

  it('能力：一点只能跟位置，两点以上、平面能转能缩，四点与平面可角点贴合', () => {
    expect(videoEditTrackerFollowAbilities({ method: 'point', prompts: [{ timeUs: 0, points: [[0.5, 0.5, 1]] }] })).toEqual({ rotation: false, scale: false, cornerPin: false })
    expect(videoEditTrackerFollowAbilities({ method: 'point', prompts: [{ timeUs: 0, points: [[0.1, 0.1, 1], [0.9, 0.1, 1], [0.9, 0.9, 1], [0.1, 0.9, 1]] }] })).toEqual({ rotation: true, scale: true, cornerPin: true })
    expect(videoEditTrackerFollowAbilities({ method: 'box', prompts: [{ timeUs: 0, box: [0.1, 0.1, 0.2, 0.2] }] })).toEqual({ rotation: false, scale: true, cornerPin: false })
    expect(() => videoEditFollowBinding({ x: 0, y: 0 }, { clipId: 'a', trackerId: 'b', placement: target, picture }, frame, { box }, { rotation: true })).toThrow('跟随旋转')
  })
})
