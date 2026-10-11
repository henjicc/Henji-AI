import { describe, expect, it } from 'vitest'
import { cameraPoseError, createCameraCandidates, prepareCameraRecording, type CameraPose3D, type CameraRecordingSample3D } from './cameraAdapter'
import type { CandidateIdentity, ClockSegment } from './contracts'

const pose: CameraPose3D = { position: { x: 0, y: 0, z: 10 }, target: { x: 0, y: 0, z: 0 }, orientation: [0, 0, 0, 1], fovDegrees: 50 }
const identity: CandidateIdentity = { ownerRef: { kind: 'camera_stage.project', id: 'p' }, sourceDraftDigest: `sha256:${'a'.repeat(64)}`, algorithmVersion: 'test', requestKey: 'test', targetBases: [] }
const timeline = (frame: number) => ({ frame, sequenceRef: identity.ownerRef, fps: { numerator: 30, denominator: 1 }, visitRef: 'visit' })
const clocks: ClockSegment[] = [{ id: 'scrub', monoSpanUs: [0, 100], mode: 'scrub', start: timeline(0), end: timeline(60), anchors: [] }]
const sample = (seq: number, frame: number): CameraRecordingSample3D => ({ id: `sample-${seq}`, seq, monoUs: seq, timeline: timeline(frame), clockSegmentRef: 'scrub', intent: 'demonstrate', confirmed: true, pose })

describe('3D 共核时间、约束和候选', () => {
  it('reverse recording keeps pose/time association; a direction change and held-frame revisit split takes', () => {
    const result = prepareCameraRecording([sample(1, 60), sample(2, 30), sample(3, 0), sample(4, 30), sample(5, 30)], clocks)
    expect(result.map(take => take.map(anchor => [anchor.id, anchor.frame]))).toEqual([
      [['sample-3', 0], ['sample-2', 30], ['sample-1', 60]], [['sample-3', 0], ['sample-4', 30]], [['sample-5', 30]],
    ])
  })
  it('navigation and missing presentation do not invent a path; invalid clocks/cancellation reject', () => {
    expect(prepareCameraRecording([{ ...sample(1, 0), intent: 'navigate' }], clocks)).toEqual([])
    expect(() => prepareCameraRecording([sample(2, 0), sample(1, 1)], clocks)).toThrow('墙钟')
    expect(() => prepareCameraRecording([sample(1, 0)], clocks, { cancelled: () => true })).toThrow()
    expect(() => prepareCameraRecording([{ ...sample(1, 0), clockSegmentRef: 'missing' }], clocks)).toThrow('未知时钟段')
  })
  it('quaternion sign equivalence is exact, and stationary optical changes are not discarded', () => {
    expect(cameraPoseError(pose, { ...pose, orientation: [0, 0, 0, -1], fovDegrees: 35 }, 10)).toEqual({ positionRatio: 0, targetRatio: 0, angleDegrees: 0, fovDegrees: 15 })
  })
  it('all three families share exact full-pose pins; conflicting candidates are unavailable', () => {
    const anchors = [{ id: 'a', frame: 0, pose }, { id: 'b', frame: 30, pose }]
    const input = { identity, anchors, pinnedIds: ['b'], sceneScale: 10 }
    const result = createCameraCandidates(input, {
      compile: family => family,
      evaluate: family => family === 'orbit' ? { ...pose, fovDegrees: 45 } : pose,
    })
    expect(result.candidates.map(c => c.id)).toEqual(['smooth', 'dolly-hold'])
    expect(result.unavailable[0]).toMatchObject({ family: 'orbit', code: 'camera-pin-conflict', refs: ['b'] })
    expect(input.anchors).toEqual(anchors)
    expect(() => createCameraCandidates({ ...input, pinnedIds: ['missing'] }, { compile: () => pose, evaluate: value => value })).toThrow('不存在')
    expect(() => createCameraCandidates({ ...input, anchors: [anchors[0], { ...anchors[1], frame: 0 }] }, { compile: () => pose, evaluate: value => value })).toThrow('正式帧')
  })
  it('degenerate sightlines, invalid optics and nonunit orientation fail before compilation', () => {
    for (const invalid of [{ ...pose, target: pose.position }, { ...pose, fovDegrees: 180 }, { ...pose, orientation: [0, 0, 0, 2] as [number, number, number, number] }]) {
      expect(() => createCameraCandidates({ identity, anchors: [{ id: 'a', frame: 0, pose: invalid }, { id: 'b', frame: 30, pose }], pinnedIds: [], sceneScale: 10 }, { compile: () => pose, evaluate: value => value })).toThrow()
    }
  })
})
