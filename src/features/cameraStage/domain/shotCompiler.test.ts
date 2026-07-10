import { describe, expect, it } from 'vitest'
import { getAnimatablePropByPath } from './animatableProps'
import type { StageTrack } from './animationTypes'
import { sampleTrack } from './keyframeEngine'
import { createCameraObject, createCharacterObject, createPrimitiveObject, pickDefaultColor } from './sceneDefaults'
import { compileShotsToAnimation } from './shotCompiler'
import { createShot } from './shotTypes'

describe('compileShotsToAnimation', () => {
  it('两卡仅一个对象位置变化时，只为变化分量建轨道，关键帧时间与 hold/过渡时长吻合', () => {
    const box = createPrimitiveObject('box', 'Box', pickDefaultColor(0))
    const shotA = createShot([box], '卡1')
    shotA.hold = 1
    shotA.transitionDuration = 2
    const shotB = createShot([box], '卡2')
    shotB.hold = 1
    shotB.objectStates[box.id] = {
      ...shotB.objectStates[box.id],
      transform: {
        ...shotB.objectStates[box.id].transform,
        position: { ...shotB.objectStates[box.id].transform.position, x: 5 },
      },
    }

    const animation = compileShotsToAnimation([shotA, shotB], [box])

    expect(animation.tracks).toHaveLength(1)
    const track = animation.tracks[0]
    expect(track.objectId).toBe(box.id)
    expect(track.propertyPath).toBe('transform.position.x')
    expect(getAnimatablePropByPath(track.propertyPath)).toBeDefined()
    expect(track.keyframes).toHaveLength(2)
    expect(track.keyframes[0].time).toBeCloseTo(1, 5)
    expect(track.keyframes[0].value).toBeCloseTo(0, 5)
    expect(track.keyframes[1].time).toBeCloseTo(3, 5)
    expect(track.keyframes[1].value).toBeCloseTo(5, 5)
    expect(animation.duration).toBeCloseTo(4, 5)
  })

  it('对象状态在两卡间完全未变化时不产生任何轨道', () => {
    const box = createPrimitiveObject('box', 'Box', pickDefaultColor(0))
    const shotA = createShot([box], '卡1')
    const shotB = createShot([box], '卡2')

    const animation = compileShotsToAnimation([shotA, shotB], [box])

    expect(animation.tracks).toHaveLength(0)
  })

  it('中间卡停留时长>0时，停留段内采样值保持恒定，不被跨卡插值污染', () => {
    const box = createPrimitiveObject('box', 'Box', pickDefaultColor(0))

    const shot1 = createShot([box], '卡1')
    shot1.hold = 0.5
    shot1.transitionDuration = 1

    const shot2 = createShot([box], '卡2')
    shot2.hold = 2
    shot2.transitionDuration = 1
    shot2.objectStates[box.id] = {
      ...shot2.objectStates[box.id],
      transform: {
        ...shot2.objectStates[box.id].transform,
        position: { ...shot2.objectStates[box.id].transform.position, x: 10 },
      },
    }

    const shot3 = createShot([box], '卡3')
    shot3.hold = 0.5
    shot3.objectStates[box.id] = {
      ...shot3.objectStates[box.id],
      transform: {
        ...shot3.objectStates[box.id].transform,
        position: { ...shot3.objectStates[box.id].transform.position, x: 20 },
      },
    }

    const animation = compileShotsToAnimation([shot1, shot2, shot3], [box])
    const track = animation.tracks.find((item) => item.propertyPath === 'transform.position.x')
    expect(track).toBeDefined()

    // 时间轴：卡1 hold[0,0.5] 过渡[0.5,1.5]；卡2 hold[1.5,3.5] 过渡[3.5,4.5]；卡3 hold[4.5,5]
    // 停留段 = 卡2 的 hold 区间 [1.5, 3.5]
    expect(sampleTrack(track as StageTrack, 1.5, 'scalar')).toBeCloseTo(10, 5)
    expect(sampleTrack(track as StageTrack, 2.5, 'scalar')).toBeCloseTo(10, 5)
    expect(sampleTrack(track as StageTrack, 3.5, 'scalar')).toBeCloseTo(10, 5)
  })

  it.each([
    ['uniform', 'linear'],
    ['easeInOut', 'easeInOut'],
    ['fastStart', 'easeOut'],
    ['slowStart', 'easeIn'],
  ] as const)('速度预设 %s 映射为缓动 %s', (preset, expectedEasing) => {
    const box = createPrimitiveObject('box', 'Box', pickDefaultColor(0))
    const shotA = createShot([box], '卡1')
    shotA.transition.perObject[box.id] = { speedPreset: preset }
    const shotB = createShot([box], '卡2')
    shotB.objectStates[box.id] = {
      ...shotB.objectStates[box.id],
      transform: {
        ...shotB.objectStates[box.id].transform,
        position: { ...shotB.objectStates[box.id].transform.position, x: 3 },
      },
    }

    const animation = compileShotsToAnimation([shotA, shotB], [box])
    const track = animation.tracks.find((item) => item.propertyPath === 'transform.position.x')

    expect(track?.keyframes[0].easing).toBe(expectedEasing)
  })

  describe('错峰延迟', () => {
    function buildDelayCase(delay: number): StageTrack {
      const box = createPrimitiveObject('box', 'Box', pickDefaultColor(0))
      const shotA = createShot([box], '卡1')
      shotA.hold = 0.5
      shotA.transitionDuration = 2
      shotA.transition.perObject[box.id] = { delay }
      const shotB = createShot([box], '卡2')
      shotB.objectStates[box.id] = {
        ...shotB.objectStates[box.id],
        transform: {
          ...shotB.objectStates[box.id].transform,
          position: { ...shotB.objectStates[box.id].transform.position, x: 4 },
        },
      }

      const animation = compileShotsToAnimation([shotA, shotB], [box])
      const track = animation.tracks.find((item) => item.propertyPath === 'transform.position.x')
      expect(track).toBeDefined()
      return track as StageTrack
    }

    it('正延迟：起止时间整体后移，上限钳制在过渡结束时间内', () => {
      const track = buildDelayCase(0.5)
      expect(track.keyframes).toHaveLength(2)
      expect(track.keyframes[0].time).toBeCloseTo(1.0, 5)
      expect(track.keyframes[1].time).toBeCloseTo(2.5, 5)
    })

    it('负延迟：起止时间整体前移，下限钳制在过渡开始时间内', () => {
      const track = buildDelayCase(-0.3)
      expect(track.keyframes).toHaveLength(2)
      expect(track.keyframes[0].time).toBeCloseTo(0.5, 5)
      expect(track.keyframes[1].time).toBeCloseTo(2.2, 5)
    })

    it('超界延迟被钳制到过渡区间边界，起止重合为单点跳变', () => {
      const trackPositive = buildDelayCase(100)
      expect(trackPositive.keyframes).toHaveLength(1)
      expect(trackPositive.keyframes[0].time).toBeCloseTo(2.5, 5)
      expect(trackPositive.keyframes[0].value).toBeCloseTo(4, 5)

      const trackNegative = buildDelayCase(-100)
      expect(trackNegative.keyframes).toHaveLength(1)
      expect(trackNegative.keyframes[0].time).toBeCloseTo(0.5, 5)
      expect(trackNegative.keyframes[0].value).toBeCloseTo(4, 5)
    })
  })

  it('空 shots 数组返回空轨道与 0 时长', () => {
    const box = createPrimitiveObject('box', 'Box', pickDefaultColor(0))
    const animation = compileShotsToAnimation([], [box])
    expect(animation.tracks).toEqual([])
    expect(animation.duration).toBe(0)
  })

  it('单卡返回空轨道，时长等于该卡的停留时长', () => {
    const box = createPrimitiveObject('box', 'Box', pickDefaultColor(0))
    const shot = createShot([box], '卡1')
    shot.hold = 1.25
    const animation = compileShotsToAnimation([shot], [box])
    expect(animation.tracks).toEqual([])
    expect(animation.duration).toBeCloseTo(1.25, 5)
  })

  it('产物 propertyPath 均可被 animatableProps 注册表解析；对象缺快照时该卡不参与该对象差异', () => {
    const box = createPrimitiveObject('box', 'Box', pickDefaultColor(0))
    const character = createCharacterObject('Character', pickDefaultColor(1))
    const camera = createCameraObject('Camera', pickDefaultColor(2))

    const shot1 = createShot([box, character, camera], '卡1')
    shot1.hold = 0.5
    shot1.transitionDuration = 1

    const shot2 = createShot([box, character, camera], '卡2')
    shot2.objectStates[camera.id] = {
      ...shot2.objectStates[camera.id],
      transform: {
        ...shot2.objectStates[camera.id].transform,
        position: { ...shot2.objectStates[camera.id].transform.position, x: 2 },
      },
      fov: 70,
    }
    const characterPose = shot2.objectStates[character.id].pose
    if (characterPose) {
      shot2.objectStates[character.id] = {
        ...shot2.objectStates[character.id],
        pose: { ...characterPose, joints: { ...characterPose.joints, head: { x: 10, y: 0, z: 0 } } },
      }
    }
    // 模拟"对象在该卡缺快照"（后加入场景的对象未被这张卡捕获）
    delete shot2.objectStates[box.id]

    const animation = compileShotsToAnimation([shot1, shot2], [box, character, camera])

    expect(animation.tracks.length).toBeGreaterThan(0)
    for (const track of animation.tracks) {
      expect(getAnimatablePropByPath(track.propertyPath)).toBeDefined()
      expect(track.objectId).not.toBe(box.id)
    }
  })
})
