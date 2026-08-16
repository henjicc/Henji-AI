import type {
  ApplicationAvailabilityRecovery,
  ApplicationAvailabilityBlock,
  ApplicationCollectionAvailability,
  ApplicationRef,
} from '@/core/application-control'

import type { CameraStageProjectSnapshot } from '../projects/cameraStageProjectService'

const TYPES = {
  project: 'camera_stage.project',
  scene: 'camera_stage.scene',
  stateKeyframe: 'camera_stage.state_keyframe',
  playback: 'camera_stage.playback',
} as const

export function cameraStageProjectIdFromRef(ref: ApplicationRef): string {
  if (ref.kind === TYPES.project || ref.kind === TYPES.scene || ref.kind === TYPES.playback) return ref.id
  const separator = ref.id.indexOf(':')
  return separator > 0 ? ref.id.slice(0, separator) : ref.id
}

export function cameraStagePropertyRestriction(
  entityType: string,
  propertyId: string,
  snapshot: CameraStageProjectSnapshot,
): { reason: string; recoveries: ApplicationAvailabilityRecovery[]; blocks: ApplicationAvailabilityBlock[] } | null {
  if (entityType === TYPES.playback && propertyId === `${TYPES.playback}.playing`) {
    const empty = snapshot.stateKeyframes.length < 2 || snapshot.animation.duration <= 0
    if (empty) return {
      reason: '当前时间轴没有可播放的时间跨度；至少需要两个不同时间的状态关键帧。',
      recoveries: [],
      blocks: [{
        kind: 'state',
        requirementId: 'camera_stage.playable_timeline',
        affectedEntityTypes: [TYPES.stateKeyframe],
        revisionScopes: ['toolbox'],
      }],
    }
  }
  return null
}

export function cameraStageCollectionAvailability(
  entityType: string,
  parent: ApplicationRef,
  _snapshot: CameraStageProjectSnapshot,
  revision: number,
): ApplicationCollectionAvailability {
  const available = entityType === TYPES.stateKeyframe
  const operation = {
    available,
    reasons: available ? [] : ['该实体没有可写集合。'],
    requiredPermissions: ['camera_stage:write'],
    recoveries: [],
  }
  return {
    entityType,
    parent,
    create: operation,
    remove: operation,
    revisions: { toolbox: revision },
  }
}
