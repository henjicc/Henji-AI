import { AnimationClip, AnimationMixer, Group } from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { CharacterMotionLayer } from '../domain/characterMotionTimeline'
import { CharacterClipPlaybackController } from './characterClipPlayback'

const clip = (clipName: 'Walk_Loop' | 'Idle_Loop', clipTime: number, weight: number): CharacterMotionLayer => ({
  motion: { mode: 'clip', clipName, speed: 1 }, clipTime, weight,
})

describe('CharacterClipPlaybackController', () => {
  it('交叉淡入淡出时两段片段按权重同时生效，片段时间取领域层给的值；回到姿态时停掉全部片段', () => {
    const root = new Group()
    const mixer = new AnimationMixer(root)
    const walk = new AnimationClip('Walk_Loop', 1.333, [])
    const idle = new AnimationClip('Idle_Loop', 2.5, [])
    const clipAction = vi.spyOn(mixer, 'clipAction')
    const controller = new CharacterClipPlaybackController(mixer, root, [walk, idle])

    expect(controller.apply([clip('Walk_Loop', 0.4, 1)])).toBe(0)
    expect(controller.apply([clip('Idle_Loop', 0.1, 0.25), clip('Walk_Loop', 0.5, 0.75)])).toBe(0)
    const walkAction = mixer.existingAction(walk, root)!
    const idleAction = mixer.existingAction(idle, root)!
    expect(walkAction.time).toBeCloseTo(0.5)
    expect(walkAction.getEffectiveWeight()).toBeCloseTo(0.75)
    expect(idleAction.getEffectiveWeight()).toBeCloseTo(0.25)
    expect(clipAction.mock.calls.filter(([candidate]) => candidate === walk)).toHaveLength(1)

    expect(controller.apply([{ motion: { mode: 'pose' }, clipTime: 0, weight: 1 }])).toBe(1)
    expect(controller.clipDriven).toBe(false)
    expect(walkAction.isRunning()).toBe(false)
  })
})
