import { AnimationClip, AnimationMixer, Group } from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { ResolvedCharacterMotion } from '../domain/animationTypes'
import { CharacterClipPlaybackController } from './characterClipPlayback'

const clipMotion = (
  timeOrigin: number,
  speed: number,
): ResolvedCharacterMotion => ({
  motion: { mode: 'clip', clipName: 'Walk_Loop', speed },
  timeOrigin,
})

describe('CharacterClipPlaybackController', () => {
  it('同一 clip 连续帧只创建一次 action，但逐帧采用最新 timeOrigin 和 speed', () => {
    const root = new Group()
    const mixer = new AnimationMixer(root)
    const clip = new AnimationClip('Walk_Loop', 2, [])
    const clipAction = vi.spyOn(mixer, 'clipAction')
    const setTime = vi.spyOn(mixer, 'setTime')
    const controller = new CharacterClipPlaybackController(mixer, root, [clip])

    expect(controller.apply(clipMotion(1, 1), 1.25)).toBe(true)
    expect(controller.apply(clipMotion(2, 2), 2.4)).toBe(true)

    expect(clipAction).toHaveBeenCalledTimes(1)
    expect(setTime).toHaveBeenLastCalledWith(expect.closeTo(0.8))
  })

  it('clip/FK 边界和缺失片段立即停止旧 action，回到同片段时重新启用', () => {
    const root = new Group()
    const mixer = new AnimationMixer(root)
    const clip = new AnimationClip('Walk_Loop', 2, [])
    const action = mixer.clipAction(clip, root)
    const stop = vi.spyOn(action, 'stop')
    const controller = new CharacterClipPlaybackController(mixer, root, [clip])

    expect(controller.apply(clipMotion(0, 1), 0.5)).toBe(true)
    expect(controller.apply({ motion: { mode: 'pose' }, timeOrigin: 1 }, 1)).toBe(false)
    expect(stop).toHaveBeenCalledTimes(1)
    expect(controller.clipDriven).toBe(false)

    expect(controller.apply(clipMotion(1, 1), 1.1)).toBe(true)
    expect(controller.clipDriven).toBe(true)
  })
})
