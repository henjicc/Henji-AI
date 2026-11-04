import { AnimationClip, LoopRepeat, QuaternionKeyframeTrack, type AnimationAction, type AnimationMixer, type Object3D } from 'three'
import { WAVE_GESTURE } from '../domain/characterGestures.gen'
import type { CharacterMotionLayer } from '../domain/characterMotionTimeline'

/**
 * 角色动作的命令式逐帧控制器：按动作时间线给出的各层（片段、片段内时间、权重）设定 action，
 * 再推一次 mixer。片段内时间由领域层算好（循环取模、一次性动作停在最后一帧、走跑按路程推进），
 * 这里不让 mixer 自己累积时间，所以播放、拖动时间轴与导出逐帧一致。
 * 姿态（pose）层不经过 mixer，由调用方按返回的 poseWeight 把骨骼混向 FK 姿态。
 */
export class CharacterClipPlaybackController {
  private readonly actions = new Map<string, AnimationAction>()
  private readonly clips: readonly AnimationClip[]

  constructor(
    private readonly mixer: AnimationMixer,
    private readonly root: Object3D,
    clips: readonly AnimationClip[],
  ) {
    this.clips = withGestureClips(clips)
  }

  get clipDriven(): boolean {
    return this.actions.size > 0
  }

  /** 返回 FK 姿态应占的权重：0 完全由片段驱动，1 完全是姿态。 */
  apply(layers: readonly CharacterMotionLayer[]): number {
    const clipLayers = new Map<string, { clip: AnimationClip; clipTime: number; weight: number }>()
    let poseWeight = 0
    for (const layer of layers) {
      const motion = layer.motion
      const clip = motion.mode === 'clip' ? this.clips.find((candidate) => candidate.name === motion.clipName) : undefined
      if (!clip) {
        poseWeight += layer.weight
        continue
      }
      // 同一片段只有一个 action：两层用同一片段（走路接原地转身）时取权重大的那层的时间。
      const existing = clipLayers.get(clip.name)
      if (!existing) clipLayers.set(clip.name, { clip, clipTime: layer.clipTime, weight: layer.weight })
      else clipLayers.set(clip.name, { clip, clipTime: existing.weight >= layer.weight ? existing.clipTime : layer.clipTime, weight: existing.weight + layer.weight })
    }

    for (const [name, action] of this.actions) {
      if (clipLayers.has(name)) continue
      action.stop()
      this.actions.delete(name)
    }
    const clipWeight = 1 - poseWeight
    if (clipLayers.size === 0 || clipWeight <= 1e-4) {
      for (const action of this.actions.values()) action.stop()
      this.actions.clear()
      return 1
    }
    for (const { clip, clipTime, weight } of clipLayers.values()) {
      let action = this.actions.get(clip.name)
      if (!action) {
        action = this.mixer.clipAction(clip, this.root)
        action.reset()
        action.setLoop(LoopRepeat, Infinity)
        action.clampWhenFinished = false
        action.enabled = true
        action.play()
        this.actions.set(clip.name, action)
      }
      // 片段之间按各自权重混合，总和归一；与姿态的混合由调用方在 mixer 之后做。
      action.setEffectiveWeight(weight / clipWeight)
      action.time = clipTime
    }
    this.mixer.update(0)
    return poseWeight
  }

  dispose(): void {
    for (const action of this.actions.values()) action.stop()
    this.actions.clear()
  }
}

/** 动作库没有的手势按生成的关节曲线补成片段：以底子片段为准，只替换手势用到的骨骼。 */
function withGestureClips(clips: readonly AnimationClip[]): AnimationClip[] {
  const base = clips.find((clip) => clip.name === WAVE_GESTURE.base)
  if (!base || clips.some((clip) => clip.name === 'Wave')) return [...clips]
  const replaced = new Set(Object.keys(WAVE_GESTURE.tracks).map((bone) => `${bone}.quaternion`))
  const tracks = [
    ...base.tracks.filter((track) => !replaced.has(track.name)).map((track) => track.clone()),
    ...Object.entries(WAVE_GESTURE.tracks).map(([bone, values]) => new QuaternionKeyframeTrack(`${bone}.quaternion`, WAVE_GESTURE.times, values)),
  ]
  return [...clips, new AnimationClip('Wave', WAVE_GESTURE.duration, tracks)]
}
