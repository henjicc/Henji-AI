import { cameraStageApplicationService } from './cameraStageApplicationService'
import { useCameraStageStore } from '../store/cameraStageStore'
import type { ApplicationRef } from '@/core/application-control'

type ExpectedSampleValue = number | string | { x: number; y: number; z: number }

export interface CameraStageExpectedStateSample {
  objectId?: string
  objectRef?: ApplicationRef
  time: number
  propertyId: string
  value: ExpectedSampleValue
}

export interface CameraStageVerificationRequest {
  projectId: string
  expectedObjectIds: string[]
  expectedObjectRefs?: ApplicationRef[]
  expectedCameraId?: string
  expectedMoveKind?: 'orbit' | 'dollyIn' | 'dollyOut' | 'truck' | 'crane'
  expectedStateSamples?: CameraStageExpectedStateSample[]
  expectedPlayback?: { playing?: boolean; loop?: boolean }
  requireNoCollisions: boolean
}

export interface CameraStageVerificationEvidence {
  kind: 'entity' | 'camera' | 'layout' | 'trajectory' | 'state_keyframe' | 'playback'
  fact: string
  refs: string[]
  data?: Record<string, unknown>
}

export interface CameraStageVerificationResult {
  verified: boolean
  evidence: CameraStageVerificationEvidence[]
  unmetConditions: string[]
  checkedAt: string
}

function readNestedValue(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => (
    current && typeof current === 'object' ? Reflect.get(current, segment) : undefined
  ), source)
}

function samplePath(propertyId: string): string | null {
  const match = /^camera_stage\.(?:object|camera)\.animatable\.(.+)$/.exec(propertyId)
  return match?.[1] ?? null
}

function valuesEqual(actual: unknown, expected: ExpectedSampleValue): boolean {
  if (typeof actual === 'number' && typeof expected === 'number') {
    return Math.abs(actual - expected) <= 1e-6
  }
  if (typeof actual === 'string' || typeof expected === 'string') return actual === expected
  if (!actual || typeof actual !== 'object' || !expected || typeof expected !== 'object') return false
  return ['x', 'y', 'z'].every((axis) => {
    const actualValue = Reflect.get(actual, axis)
    const expectedValue = Reflect.get(expected, axis)
    return typeof actualValue === 'number' && typeof expectedValue === 'number'
      && Math.abs(actualValue - expectedValue) <= 1e-6
  })
}

function localEntityId(projectId: string, value: string | ApplicationRef): string {
  const id = typeof value === 'string' ? value : value.id
  const prefix = `${projectId}:`
  return id.startsWith(prefix) ? id.slice(prefix.length) : id
}

export async function verifyCameraStageScene(
  request: CameraStageVerificationRequest,
): Promise<CameraStageVerificationResult> {
  const [scene, snapshot] = await Promise.all([
    cameraStageApplicationService.observeProject(request.projectId),
    cameraStageApplicationService.readSnapshot(request.projectId),
  ])
  const evidence: CameraStageVerificationEvidence[] = []
  const unmetConditions: string[] = []
  const objectIds = new Set(scene.objects.map((object) => object.id))

  const expectedObjectIds = [
    ...request.expectedObjectIds,
    ...(request.expectedObjectRefs ?? []).map((ref) => localEntityId(request.projectId, ref)),
  ]
  const missingObjects = expectedObjectIds.filter((id) => !objectIds.has(id))
  if (missingObjects.length === 0) {
    evidence.push({
      kind: 'entity',
      fact: `预期的 ${expectedObjectIds.length} 个三维对象均存在。`,
      refs: expectedObjectIds,
    })
  } else {
    unmetConditions.push(`缺少对象：${missingObjects.join('、')}`)
  }

  if (request.expectedCameraId) {
    const camera = scene.objects.find((object) => object.id === request.expectedCameraId && object.type === 'camera')
    if (camera && scene.activeCameraId === camera.id) {
      evidence.push({ kind: 'camera', fact: '目标摄像机存在且为活动摄像机。', refs: [camera.id] })
    } else {
      unmetConditions.push('目标摄像机不存在或不是活动摄像机。')
    }
  }

  if (request.requireNoCollisions) {
    if (scene.collisions.length === 0) {
      evidence.push({ kind: 'layout', fact: '可见非摄像机对象之间没有边界盒重叠。', refs: [] })
    } else {
      unmetConditions.push(`检测到 ${scene.collisions.length} 组对象边界盒重叠。`)
    }
  }

  if (request.expectedMoveKind) {
    const trajectories = scene.trajectories.filter((trajectory) => trajectory.source === request.expectedMoveKind)
    if (trajectories.length > 0) {
      evidence.push({
        kind: 'trajectory',
        fact: `已找到 ${request.expectedMoveKind} 运镜轨迹。`,
        refs: trajectories.map((trajectory) => `${trajectory.stateKeyframeId}:${trajectory.objectId}`),
        data: { trajectoryCount: trajectories.length },
      })
    } else {
      unmetConditions.push(`未找到 ${request.expectedMoveKind} 运镜轨迹。`)
    }
  }

  const sampleFacts: Array<Record<string, unknown>> = []
  for (const expected of request.expectedStateSamples ?? []) {
    const objectId = localEntityId(
      request.projectId,
      expected.objectRef ?? expected.objectId ?? '',
    )
    const keyframe = snapshot.stateKeyframes.find((item) => Math.abs(item.time - expected.time) <= 1e-6)
    const path = samplePath(expected.propertyId)
    const actual = keyframe && path
      ? readNestedValue(keyframe.objectStates[objectId], path)
      : undefined
    if (keyframe && path && valuesEqual(actual, expected.value)) {
      sampleFacts.push({
        stateKeyframeId: keyframe.id,
        objectId,
        time: keyframe.time,
        propertyId: expected.propertyId,
        value: actual,
      })
    } else {
      unmetConditions.push(
        `状态关键帧采样不符：${objectId} 在 ${expected.time}s 的 ${expected.propertyId}`
      )
    }
  }
  if (sampleFacts.length > 0) {
    evidence.push({
      kind: 'state_keyframe',
      fact: `${sampleFacts.length} 项状态关键帧采样值均与预期一致。`,
      refs: [...new Set(sampleFacts.map((item) => String(item.stateKeyframeId)))],
      data: { samples: sampleFacts },
    })
  }

  if (request.expectedPlayback) {
    const state = useCameraStageStore.getState()
    if (state.currentProjectId !== request.projectId) {
      unmetConditions.push('目标工程当前未加载，无法验证瞬时播放状态。')
    } else {
      const expected = request.expectedPlayback
      const mismatched = [
        ...(expected.playing !== undefined && state.playback.playing !== expected.playing ? ['playing'] : []),
        ...(expected.loop !== undefined && state.playback.loop !== expected.loop ? ['loop'] : []),
      ]
      if (mismatched.length > 0) {
        unmetConditions.push(`播放状态不符：${mismatched.join('、')}`)
      } else {
        evidence.push({
          kind: 'playback',
          fact: '播放控制状态与预期一致。',
          refs: [request.projectId],
          data: {
            playing: state.playback.playing,
            loop: state.playback.loop,
            currentTime: state.playback.currentTime,
          },
        })
      }
    }
  }

  return {
    verified: unmetConditions.length === 0,
    evidence,
    unmetConditions,
    checkedAt: new Date().toISOString(),
  }
}
