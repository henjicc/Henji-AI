import { cameraStageApplicationService } from './cameraStageApplicationService'

export interface CameraStageVerificationRequest {
  projectId: string
  expectedObjectIds: string[]
  expectedCameraId?: string
  expectedMoveKind?: 'orbit' | 'dollyIn' | 'dollyOut' | 'truck' | 'crane'
  requireNoCollisions: boolean
}

export interface CameraStageVerificationEvidence {
  kind: 'entity' | 'camera' | 'layout' | 'trajectory' | 'keyframe'
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

export async function verifyCameraStageScene(
  request: CameraStageVerificationRequest,
): Promise<CameraStageVerificationResult> {
  const scene = await cameraStageApplicationService.observeProject(request.projectId)
  const evidence: CameraStageVerificationEvidence[] = []
  const unmetConditions: string[] = []
  const objectIds = new Set(scene.objects.map((object) => object.id))

  const missingObjects = request.expectedObjectIds.filter((id) => !objectIds.has(id))
  if (missingObjects.length === 0) {
    evidence.push({
      kind: 'entity',
      fact: `预期的 ${request.expectedObjectIds.length} 个三维对象均存在。`,
      refs: request.expectedObjectIds,
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
        refs: trajectories.map((trajectory) => `${trajectory.shotId}:${trajectory.objectId}`),
        data: { trajectoryCount: trajectories.length },
      })
    } else if (scene.project.editorMode === 'pro' && scene.keyframeCount > 0) {
      evidence.push({
        kind: 'keyframe',
        fact: `专业模式已生成 ${scene.keyframeCount} 个关键帧；轨迹类型由本次事务证据确认。`,
        refs: [],
        data: { keyframeCount: scene.keyframeCount },
      })
    } else {
      unmetConditions.push(`未找到 ${request.expectedMoveKind} 运镜轨迹或关键帧证据。`)
    }
  }

  return {
    verified: unmetConditions.length === 0,
    evidence,
    unmetConditions,
    checkedAt: new Date().toISOString(),
  }
}
