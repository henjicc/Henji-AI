import { describe, expect, it } from 'vitest'
import { getAnimatablePropByPath } from './animatableProps'
import type { StageTrack } from './animationTypes'
import { sampleTrack } from './keyframeEngine'
import { createCameraObject, createCharacterObject, createPrimitiveObject, pickDefaultColor } from './sceneDefaults'
import { buildShotTimeline, compileShotsToAnimation } from './shotCompiler'
import { createShot } from './shotTypes'

describe('compileShotsToAnimation', () => {
  it('角色位移生成转身轨道与可覆盖的动作时间表', () => {
    const character = createCharacterObject('Character', pickDefaultColor(1))
    const shotA = createShot([character], '卡1')
    shotA.hold = 1
    shotA.transitionDuration = 1
    shotA.transition.perObject[character.id] = {
      motionOverride: { mode: 'clip', clipName: 'Walk_Formal_Loop', speed: 0.8 },
    }
    const shotB = createShot([character], '卡2')
    shotB.objectStates[character.id] = {
      ...shotB.objectStates[character.id],
      transform: {
        ...shotB.objectStates[character.id].transform,
        position: { ...shotB.objectStates[character.id].transform.position, x: 3 },
      },
    }
    shotB.objectStates[character.id].motion = { mode: 'clip', clipName: 'Idle_Loop', speed: 1 }

    const animation = compileShotsToAnimation([shotA, shotB], [character])
    const yawTrack = animation.tracks.find((track) => track.propertyPath === 'transform.rotation.y')

    expect(yawTrack?.keyframes).toHaveLength(4)
    expect(yawTrack?.keyframes[1].value).toBeCloseTo(90, 5)
    expect(animation.motionSchedule).toEqual([{
      objectId: character.id,
      startTime: 1,
      endTime: 2,
      motion: { mode: 'clip', clipName: 'Walk_Formal_Loop', speed: 0.8 },
      afterMotion: { mode: 'clip', clipName: 'Idle_Loop', speed: 1 },
    }])
  })

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

  describe('摄像机运镜预设接入（1.3）', () => {
    it('含 orbit 的过渡编译产物：x/y/z 轨道可被 sampleTrack 采样，中间时刻位置在圆弧上（到目标距离恒定，容差内）', () => {
      const target = { x: 0, y: 0, z: 0 }
      const startPosition = { x: 0, y: 2, z: 5 }
      const camera = createCameraObject('Camera', pickDefaultColor(2), { position: startPosition, target })

      const shotA = createShot([camera], '卡1')
      shotA.hold = 0
      shotA.transitionDuration = 4
      shotA.transition.cameraMoves[camera.id] = { kind: 'orbit', degrees: 180, direction: 'cw' }
      // B 卡机位刻意保留创建时的默认快照（未手动摆到环绕落点），验证环绕几何覆盖 B 卡机位（重要记录 003）
      const shotB = createShot([camera], '卡2')

      const animation = compileShotsToAnimation([shotA, shotB], [camera])
      const trackX = animation.tracks.find((item) => item.objectId === camera.id && item.propertyPath === 'transform.position.x')
      const trackY = animation.tracks.find((item) => item.objectId === camera.id && item.propertyPath === 'transform.position.y')
      const trackZ = animation.tracks.find((item) => item.objectId === camera.id && item.propertyPath === 'transform.position.z')
      expect(trackX).toBeDefined()
      expect(trackY).toBeDefined()
      expect(trackZ).toBeDefined()

      const startDistance = Math.hypot(
        startPosition.x - target.x,
        startPosition.y - target.y,
        startPosition.z - target.z,
      )
      for (const time of [1, 2, 3]) {
        const x = sampleTrack(trackX as StageTrack, time, 'scalar') as number
        const y = sampleTrack(trackY as StageTrack, time, 'scalar') as number
        const z = sampleTrack(trackZ as StageTrack, time, 'scalar') as number
        const dist = Math.hypot(x - target.x, y - target.y, z - target.z)
        // 相邻关键帧之间是线性插值弦近似圆弧，容差覆盖 15° 分段的弦-弧误差（远小于半径量级）
        expect(Math.abs(dist - startDistance)).toBeLessThan(0.15)
      }

      // 终点应落在环绕几何的 180° 落点（z ≈ -5），而不是 B 卡快照里未改动的原始机位（z ≈ 5）
      const endZ = sampleTrack(trackZ as StageTrack, 4, 'scalar') as number
      expect(endZ).toBeCloseTo(-5, 1)
    })

    it('非 direct 运镜的位置分量不会误伤 fov 变化：fov 仍走两点直插', () => {
      const target = { x: 0, y: 0, z: 0 }
      const camera = createCameraObject('Camera', pickDefaultColor(2), { position: { x: 0, y: 2, z: 5 }, target })

      const shotA = createShot([camera], '卡1')
      shotA.transition.cameraMoves[camera.id] = { kind: 'dollyIn', distanceRatio: 0.5 }
      const shotB = createShot([camera], '卡2')
      shotB.objectStates[camera.id] = { ...shotB.objectStates[camera.id], fov: 70 }

      const animation = compileShotsToAnimation([shotA, shotB], [camera])
      const fovTrack = animation.tracks.find((item) => item.objectId === camera.id && item.propertyPath === 'fov')
      expect(fovTrack).toBeDefined()
      expect(fovTrack?.keyframes).toHaveLength(2)
      expect(fovTrack?.keyframes[1].value).toBeCloseTo(70, 5)
    })
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

describe('buildShotTimeline 强制硬切（重要记录 005）', () => {
  it('相邻两卡机位不同时，有效过渡时长视为 0，原始 transitionDuration 不被改写', () => {
    const shotA = createShot([], '卡1', 'camera-a')
    const shotB = createShot([], '卡2', 'camera-b')
    shotA.hold = 1
    shotA.transitionDuration = 2
    shotB.hold = 1

    const timeline = buildShotTimeline([shotA, shotB])
    expect(timeline[0]).toEqual({ holdStart: 0, transitionStart: 1, transitionEnd: 1 })
    expect(shotA.transitionDuration).toBe(2)
  })

  it('未指定机位的卡（cameraId 为 null）不触发强制硬切，行为与改动前一致', () => {
    const shotA = createShot([], '卡1')
    const shotB = createShot([], '卡2')
    shotA.hold = 1
    shotA.transitionDuration = 2
    shotB.hold = 1

    const timeline = buildShotTimeline([shotA, shotB])
    expect(timeline[0]).toEqual({ holdStart: 0, transitionStart: 1, transitionEnd: 3 })
  })

  it('机位相同的相邻卡保留真实过渡时长', () => {
    const shotA = createShot([], '卡1', 'camera-a')
    const shotB = createShot([], '卡2', 'camera-a')
    shotA.hold = 1
    shotA.transitionDuration = 2
    shotB.hold = 1

    const timeline = buildShotTimeline([shotA, shotB])
    expect(timeline[0]).toEqual({ holdStart: 0, transitionStart: 1, transitionEnd: 3 })
  })

  it('机位不同的强制硬切会让编译产物在过渡起点直接跳变（无插值关键帧对）', () => {
    const camera = createCameraObject('摄像机01', pickDefaultColor(0))
    const shotA = createShot([camera], '卡1', 'camera-a')
    const shotB = createShot([camera], '卡2', 'camera-b')
    shotA.hold = 1
    shotA.transitionDuration = 2
    shotB.hold = 1
    shotB.objectStates[camera.id] = {
      ...shotB.objectStates[camera.id],
      transform: {
        ...shotB.objectStates[camera.id].transform,
        position: { ...shotB.objectStates[camera.id].transform.position, x: 5 },
      },
    }

    const animation = compileShotsToAnimation([shotA, shotB], [camera])
    const positionXTrack = animation.tracks.find(
      (track) => track.objectId === camera.id && track.propertyPath === 'transform.position.x',
    )
    expect(positionXTrack).toBeDefined()
    // 强制硬切：过渡起止时间重合（=1），只保留跳变后的目标值，没有跨时间的插值区间
    const keyframesAtCut = positionXTrack!.keyframes.filter((kf) => Math.abs(kf.time - 1) < 1e-6)
    expect(keyframesAtCut).toHaveLength(1)
    expect(keyframesAtCut[0].value).toBe(5)
  })
})
