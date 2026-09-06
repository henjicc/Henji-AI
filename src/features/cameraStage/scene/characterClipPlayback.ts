import { LoopRepeat, type AnimationAction, type AnimationClip, type AnimationMixer, type Object3D } from 'three'
import type { ResolvedCharacterMotion } from '../domain/animationTypes'

/**
 * 角色 clip 的命令式逐帧控制器。动作 identity 不变时只推进 mixer 时间，不重建 action；
 * clip/FK 的选择和 timeOrigin/speed 则在每个 runtime 帧重新解析后立即生效。
 */
export class CharacterClipPlaybackController {
  private activeClipName: string | null = null
  private activeAction: AnimationAction | null = null

  constructor(
    private readonly mixer: AnimationMixer,
    private readonly root: Object3D,
    private readonly clips: readonly AnimationClip[],
  ) {}

  get clipDriven(): boolean {
    return this.activeAction !== null
  }

  apply(resolved: ResolvedCharacterMotion, time: number): boolean {
    const { motion } = resolved
    const clipMotion = motion.mode === 'clip' ? motion : null
    const clip = clipMotion
      ? this.clips.find((candidate) => candidate.name === clipMotion.clipName) ?? null
      : null

    if (!clip || !clipMotion) {
      this.stopActiveAction()
      return false
    }

    if (this.activeClipName !== clip.name || !this.activeAction) {
      this.stopActiveAction()
      const action = this.mixer.clipAction(clip, this.root)
      action.reset()
      action.setLoop(LoopRepeat, Infinity)
      action.clampWhenFinished = false
      action.enabled = true
      action.play()
      this.activeClipName = clip.name
      this.activeAction = action
      this.mixer.update(0)
    }

    this.mixer.setTime(Math.max(0, time - resolved.timeOrigin) * clipMotion.speed)
    return true
  }

  dispose(): void {
    this.stopActiveAction()
  }

  private stopActiveAction(): void {
    this.activeAction?.stop()
    this.activeAction = null
    this.activeClipName = null
  }
}
