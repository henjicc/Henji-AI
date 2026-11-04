import type { StageSceneAnimation } from '../domain/animationTypes'
import { characterClipFacts } from '../domain/characterMotion'
import { characterMotionSpanAt } from '../domain/characterMotionTimeline'
import type { StageObject, StageVec3 } from '../domain/sceneTypes'
import { applyAnimationAtTime } from '../store/playbackSampling'
import { CAMERA_STAGE_CHARACTER_ACTIONS, CAMERA_STAGE_CHARACTER_GAITS } from '@/core/application-control/domains/cameraStage/cameraStageBlockingSchemas'

const round = (value: number, digits = 3): number => Math.round(value * 10 ** digits) / 10 ** digits
const normalizeAngle = (angle: number): number => ((angle + 180) % 360 + 360) % 360 - 180

export function clipLabel(clipName: string): string {
  return Object.values(CAMERA_STAGE_CHARACTER_ACTIONS).find((item) => item.clip === clipName)?.label
    ?? Object.values(CAMERA_STAGE_CHARACTER_GAITS).find((item) => item.clip === clipName)?.label
    ?? clipName
}

export interface CharacterReadback {
  time: number
  position: StageVec3
  /** 朝向（度，0 朝 +Z、90 朝 +X） */
  facing: number
  action: { clip: string | null; label: string; kind: 'walk' | 'turn' | 'action' | 'pose'; progress: number | null }
  moving: boolean
  speed: number
}

/** 角色动作时间线的摘要：每段从几秒到几秒、在做什么，走动的路程与速度。 */
export function characterBlockingSummary(animation: StageSceneAnimation, characterId: string): Array<Record<string, unknown>> {
  const timeline = animation.characterMotions.find((item) => item.objectId === characterId)
  return (timeline?.spans ?? []).map((span) => ({
    startTime: round(span.startTime, 2),
    endTime: Number.isFinite(span.endTime) ? round(span.endTime, 2) : null,
    kind: span.locomotion?.kind ?? (span.motion.mode === 'clip' ? 'action' : 'pose'),
    label: span.motion.mode === 'clip' ? clipLabel(span.motion.clipName) : '静态姿态',
    ...(span.motion.mode === 'clip' ? { clip: span.motion.clipName } : {}),
    ...(span.locomotion ? { distance: round(span.locomotion.distance, 2), averageSpeed: round(span.locomotion.averageSpeed, 2), playbackRate: round(span.locomotion.playbackRate, 2) } : {}),
  }))
}

/** 读回：某一时刻角色在哪、朝哪、在做什么（观察场景用）。 */
export function readCharacterAt(objects: StageObject[], animation: StageSceneAnimation, characterId: string, time: number): CharacterReadback | null {
  const frame = applyAnimationAtTime(objects, animation, time)
  const character = frame.find((object) => object.id === characterId)
  if (character?.type !== 'character') return null
  const timeline = animation.characterMotions.find((item) => item.objectId === characterId)
  const span = characterMotionSpanAt(timeline, time)
  const motion = span?.motion ?? character.motion
  const later = applyAnimationAtTime(objects, animation, time + 0.05).find((object) => object.id === characterId)!.transform.position
  const speed = Math.hypot(later.x - character.transform.position.x, later.z - character.transform.position.z) / 0.05
  const facts = motion.mode === 'clip' ? characterClipFacts(motion.clipName) : undefined
  const progress = span && motion.mode === 'clip' && facts && !facts.loop && span.clock.kind === 'time'
    ? Math.min(1, Math.max(0, ((time - span.clock.origin) * span.clock.rate) / facts.duration))
    : null
  const label = motion.mode === 'clip' ? clipLabel(motion.clipName) : '静态姿态'
  return {
    time,
    position: { x: round(character.transform.position.x), y: round(character.transform.position.y), z: round(character.transform.position.z) },
    facing: round(normalizeAngle(character.transform.rotation.y), 1),
    action: { clip: motion.mode === 'clip' ? motion.clipName : null, label, kind: span?.locomotion?.kind ?? (motion.mode === 'clip' ? 'action' : 'pose'), progress: progress === null ? null : round(progress, 2) },
    moving: speed > 0.05,
    speed: round(speed, 2),
  }
}
