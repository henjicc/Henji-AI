import { describe, expect, it } from 'vitest'
import { getAnimatablePropByPath } from './animatableProps'
import type { StageTrack } from './animationTypes'
import { sampleTrack } from './keyframeEngine'
import { createCameraObject, createCharacterObject, createPrimitiveObject, pickDefaultColor } from './sceneDefaults'
import { createCameraPresetPath, cubicSpatialPoint, sampleSpatialMotion } from './spatialPath'
import { buildStateKeyframeTimeline, compileStateKeyframesToAnimation } from './stateKeyframeCompiler'
import { createStateKeyframe, type StageSpatialPath } from './stateKeyframeTypes'
import { characterClipFacts } from './characterMotion'
import { CHARACTER_CROSSFADE_SECONDS, resolveCharacterMotionLayers, sampleCharacterHeading, spanClipTime } from './characterMotionTimeline'

describe('compileStateKeyframesToAnimation', () => {
  it('只使用绝对时间点，创建结果不携带停留字段', () => {
    const frame = createStateKeyframe([], '关键帧', null, 3)
    expect(frame).not.toHaveProperty('hold')
    expect(buildStateKeyframeTimeline([frame, { ...frame }])).toEqual([
      { holdStart: 3, transitionStart: 3, transitionEnd: 3 },
      { holdStart: 3, transitionStart: 3, transitionEnd: 3 },
    ])
  })
  it('空间贝塞尔路径登记为运行时采样段，轨道只留端点，曲线形状独立于速度时间轴', () => {
    const box = createPrimitiveObject('box', 'Box', pickDefaultColor(0))
    const stateKeyframeA = createStateKeyframe([box], '卡1', null, 0)
    const stateKeyframeB = createStateKeyframe([box], '卡2', null, 2)
    stateKeyframeB.objectStates[box.id].transform.position = { x: 6, y: 0, z: 0 }
    stateKeyframeA.transition.perObject[box.id] = {
      speedPreset: 'uniform',
      spatialPath: {
        kind: 'bezier',
        source: { kind: 'custom' },
        startOutTangent: { x: 2, y: 4, z: 0 },
        knots: [],
        endInTangent: { x: -2, y: 4, z: 0 },
      },
    }

    const animation = compileStateKeyframesToAnimation([stateKeyframeA, stateKeyframeB], [box])
    const x = animation.tracks.find((track) => track.propertyPath === 'transform.position.x')
    const y = animation.tracks.find((track) => track.propertyPath === 'transform.position.y')
    const z = animation.tracks.find((track) => track.propertyPath === 'transform.position.z')
    const fromPosition = stateKeyframeA.objectStates[box.id].transform.position
    expect(x?.keyframes.map((keyframe) => keyframe.value)).toEqual([fromPosition.x, 6])
    expect(y?.keyframes.map((keyframe) => keyframe.value)).toEqual([fromPosition.y, 0])
    expect(z?.keyframes).toHaveLength(2)
    const midpoint = cubicSpatialPoint(
      stateKeyframeA.objectStates[box.id].transform.position,
      stateKeyframeB.objectStates[box.id].transform.position,
      stateKeyframeA.transition.perObject[box.id].spatialPath as StageSpatialPath,
      0.5,
    )
    const sampled = sampleSpatialMotion(animation.spatialMotions[0], 1)!
    expect(sampled.x).toBeCloseTo(midpoint.x, 5)
    expect(sampled.y).toBeCloseTo(midpoint.y, 5)
  })

  it('角色走动按路程推进走路片段（脚钉在地上），朝向沿前进方向，到达后交叉淡入卡内动作', () => {
    const character = createCharacterObject('Character', pickDefaultColor(1))
    const stateKeyframeA = createStateKeyframe([character], '卡1', null, 1)
    stateKeyframeA.transition.perObject[character.id] = {
      speedPreset: 'cruise',
      motionOverride: { mode: 'clip', clipName: 'Walk_Formal_Loop', speed: 0.8 },
    }
    const stateKeyframeB = createStateKeyframe([character], '卡2', null, 4)
    stateKeyframeB.objectStates[character.id].transform.position = { x: 3, y: 0, z: 0 }
    stateKeyframeB.objectStates[character.id].motion = { mode: 'clip', clipName: 'Idle_Loop', speed: 1 }

    const animation = compileStateKeyframesToAnimation([stateKeyframeA, stateKeyframeB], [character])
    const spans = animation.characterMotions.find((timeline) => timeline.objectId === character.id)!.spans
    const walk = spans.find((span) => span.locomotion)!
    expect(walk).toMatchObject({ startTime: 1, endTime: 4, motion: { clipName: 'Walk_Formal_Loop' } })
    // 距离匹配：片段推进的时间 × 着地速度 = 走过的路程，速度怎么变都一样（cruise 有加减速）。
    const motion = animation.spatialMotions.find((item) => item.objectId === character.id)!
    for (const [from, to] of [[1.2, 1.5], [2.2, 2.6]] as const) {
      const distance = sampleSpatialMotion(motion, to)!.x - sampleSpatialMotion(motion, from)!.x
      const { duration, groundSpeed } = characterClipFacts('Walk_Formal_Loop')!
      const clipAdvance = ((spanClipTime(walk, to) - spanClipTime(walk, from)) % duration + duration) % duration
      expect(clipAdvance * (groundSpeed ?? 0)).toBeCloseTo(distance, 2)
    }
    expect(sampleCharacterHeading(animation.characterHeadings, character.id, 2.5)).toBeCloseTo(90, 0)
    expect(spans.find((span) => span.startTime === 4)?.motion).toEqual({ mode: 'clip', clipName: 'Idle_Loop', speed: 1 })
    const layers = resolveCharacterMotionLayers(animation.characterMotions[0], 4 + CHARACTER_CROSSFADE_SECONDS / 2, character.motion)
    expect(layers.map((layer) => layer.motion.mode === 'clip' && layer.motion.clipName)).toEqual(['Idle_Loop', 'Walk_Formal_Loop'])
    expect(layers[0].weight + layers[1].weight).toBeCloseTo(1, 6)
  })

  it('挥手做完后下一张卡再记挥手就再挥一次；还在挥的时候插卡接着挥', () => {
    const character = createCharacterObject('Character', pickDefaultColor(1))
    const wave = { mode: 'clip', clipName: 'Wave', speed: 1 } as const
    const frames = [0, 1, 4].map((time, index) => createStateKeyframe([character], `卡${index}`, null, time))
    for (const frame of frames) frame.objectStates[character.id].motion = wave
    const spans = compileStateKeyframesToAnimation(frames, [character]).characterMotions[0].spans
    expect(spans.map((span) => [span.startTime, span.motion.mode === 'clip' && span.motion.clipName])).toEqual([[0, 'Wave'], [2.4, 'Idle_Loop'], [4, 'Wave'], [6.4, 'Idle_Loop']])
    // 两拳连打：第二拳的卡落在整帧 26/30 秒，比出拳片段 0.867 秒早不到半帧，也算第一拳打完。
    const punch = { mode: 'clip', clipName: 'Punch_Jab', speed: 1 } as const
    const punches = [0, 26 / 30].map((time, index) => createStateKeyframe([character], `拳${index}`, null, time))
    for (const frame of punches) frame.objectStates[character.id].motion = punch
    const punchSpans = compileStateKeyframesToAnimation(punches, [character]).characterMotions[0].spans
    expect(punchSpans.filter((span) => span.motion.mode === 'clip' && span.motion.clipName === 'Punch_Jab')).toHaveLength(2)
  })

  it('两卡仅一个对象位置变化时，只为变化分量建轨道，关键帧时间与绝对时间点吻合', () => {
    const box = createPrimitiveObject('box', 'Box', pickDefaultColor(0))
    const stateKeyframeA = createStateKeyframe([box], '卡1')
    stateKeyframeA.time = 1
    stateKeyframeA.transitionDuration = 2
    const stateKeyframeB = createStateKeyframe([box], '卡2')
    stateKeyframeB.time = stateKeyframeA.time + stateKeyframeA.transitionDuration

    stateKeyframeB.objectStates[box.id] = {
      ...stateKeyframeB.objectStates[box.id],
      transform: {
        ...stateKeyframeB.objectStates[box.id].transform,
        position: { ...stateKeyframeB.objectStates[box.id].transform.position, x: 5 },
      },
    }

    const animation = compileStateKeyframesToAnimation([stateKeyframeA, stateKeyframeB], [box])

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
    expect(animation.duration).toBeCloseTo(3, 5)
  })

  it('对象状态在两卡间完全未变化时不产生任何轨道', () => {
    const box = createPrimitiveObject('box', 'Box', pickDefaultColor(0))
    const stateKeyframeA = createStateKeyframe([box], '卡1')
    const stateKeyframeB = createStateKeyframe([box], '卡2')
    stateKeyframeB.time = stateKeyframeA.time + stateKeyframeA.transitionDuration

    const animation = compileStateKeyframesToAnimation([stateKeyframeA, stateKeyframeB], [box])

    expect(animation.tracks).toHaveLength(0)
  })

  it('摄像机 XYZ 旋转从过渡起点开始连续插值', () => {
    const camera = createCameraObject('Camera', pickDefaultColor(2), {
      position: { x: 0, y: 1, z: 5 },
      target: { x: 0, y: 1, z: 0 },
    })
    const stateKeyframeA = createStateKeyframe([camera], '卡1')
    stateKeyframeA.transition.perObject[camera.id] = { speedPreset: 'uniform' }
    const stateKeyframeB = createStateKeyframe([camera], '卡2')
    stateKeyframeB.time = 1
    const stateB = stateKeyframeB.objectStates[camera.id]
    stateB.lookAt = { mode: 'manual', target: { x: 4, y: 1, z: 0 } }
    stateB.transform.rotation = { ...stateB.transform.rotation, z: 30 }

    const animation = compileStateKeyframesToAnimation([stateKeyframeA, stateKeyframeB], [camera])
    const rotationYTrack = animation.tracks.find((track) => track.propertyPath === 'transform.rotation.y')
    const rotationZTrack = animation.tracks.find((track) => track.propertyPath === 'transform.rotation.z')

    expect(rotationYTrack).toBeDefined()
    expect(rotationZTrack).toBeDefined()
    expect(sampleTrack(rotationYTrack!, 0, 'scalar')).toBeCloseTo(0, 5)
    expect(sampleTrack(rotationYTrack!, 0.25, 'scalar')).toBeLessThan(0)
    expect(sampleTrack(rotationYTrack!, 1, 'scalar')).toBeCloseTo(-38.6598, 4)
    expect(sampleTrack(rotationZTrack!, 0.5, 'scalar')).toBeCloseTo(15, 5)
    expect(sampleTrack(rotationZTrack!, 1, 'scalar')).toBeCloseTo(30, 5)
  })

  it('摄像机旋转跨越正负 180° 时选择最短路径', () => {
    const distance = 5
    const targetAtYaw = (degrees: number): { x: number; y: number; z: number } => {
      const radians = degrees * Math.PI / 180
      return { x: -Math.sin(radians) * distance, y: 1, z: -Math.cos(radians) * distance }
    }
    const camera = createCameraObject('Camera', pickDefaultColor(2), {
      position: { x: 0, y: 1, z: 0 },
      target: targetAtYaw(170),
    })
    const stateKeyframeA = createStateKeyframe([camera], '卡1')
    stateKeyframeA.transition.perObject[camera.id] = { speedPreset: 'uniform' }
    const stateKeyframeB = createStateKeyframe([camera], '卡2')
    stateKeyframeB.time = 1
    stateKeyframeB.objectStates[camera.id].lookAt = { mode: 'manual', target: targetAtYaw(-170) }

    const animation = compileStateKeyframesToAnimation([stateKeyframeA, stateKeyframeB], [camera])
    const yawTrack = animation.tracks.find((track) => track.propertyPath === 'transform.rotation.y')

    expect(yawTrack).toBeDefined()
    expect(sampleTrack(yawTrack!, 0, 'scalar')).toBeCloseTo(170, 5)
    expect(sampleTrack(yawTrack!, 0.5, 'scalar')).toBeCloseTo(180, 5)
    expect(sampleTrack(yawTrack!, 1, 'scalar')).toBeCloseTo(190, 5)
  })

  it('连续两个状态相同的时间点之间保持恒定，不被跨卡插值污染', () => {
    const box = createPrimitiveObject('box', 'Box', pickDefaultColor(0))

    const stateKeyframe1 = createStateKeyframe([box], '卡1')
    stateKeyframe1.time = 0.5
    stateKeyframe1.transitionDuration = 1

    const stateKeyframe2 = createStateKeyframe([box], '卡2')
    stateKeyframe2.time = 1.5
    stateKeyframe2.transitionDuration = 1
    stateKeyframe2.objectStates[box.id] = {
      ...stateKeyframe2.objectStates[box.id],
      transform: {
        ...stateKeyframe2.objectStates[box.id].transform,
        position: { ...stateKeyframe2.objectStates[box.id].transform.position, x: 10 },
      },
    }

    const stateKeyframe3 = createStateKeyframe([box], '卡3')
    stateKeyframe3.time = 4.5
    stateKeyframe3.objectStates[box.id] = {
      ...stateKeyframe3.objectStates[box.id],
      transform: {
        ...stateKeyframe3.objectStates[box.id].transform,
        position: { ...stateKeyframe3.objectStates[box.id].transform.position, x: 20 },
      },
    }

    const pauseEnd = { ...structuredClone(stateKeyframe2), id: 'pause-end', time: 3.5 }
    const animation = compileStateKeyframesToAnimation([stateKeyframe1, stateKeyframe2, pauseEnd, stateKeyframe3], [box])
    const track = animation.tracks.find((item) => item.propertyPath === 'transform.position.x')
    expect(track).toBeDefined()

    // 1.5s 与 3.5s 的快照相同，显式表示停顿。
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
    const stateKeyframeA = createStateKeyframe([box], '卡1')
    stateKeyframeA.transition.perObject[box.id] = { speedPreset: preset }
    const stateKeyframeB = createStateKeyframe([box], '卡2')
    stateKeyframeB.time = stateKeyframeA.time + stateKeyframeA.transitionDuration
    stateKeyframeB.objectStates[box.id] = {
      ...stateKeyframeB.objectStates[box.id],
      transform: {
        ...stateKeyframeB.objectStates[box.id].transform,
        position: { ...stateKeyframeB.objectStates[box.id].transform.position, x: 3 },
      },
    }

    const animation = compileStateKeyframesToAnimation([stateKeyframeA, stateKeyframeB], [box])
    const track = animation.tracks.find((item) => item.propertyPath === 'transform.position.x')

    expect(track?.keyframes[0].easing).toBe(expectedEasing)
  })

  describe('错峰延迟', () => {
    function buildDelayCase(delay: number): StageTrack {
      const box = createPrimitiveObject('box', 'Box', pickDefaultColor(0))
      const stateKeyframeA = createStateKeyframe([box], '卡1')
      stateKeyframeA.time = 0.5
      stateKeyframeA.transitionDuration = 2
      stateKeyframeA.transition.perObject[box.id] = { delay }
      const stateKeyframeB = createStateKeyframe([box], '卡2')
      stateKeyframeB.time = stateKeyframeA.time + stateKeyframeA.transitionDuration
      stateKeyframeB.objectStates[box.id] = {
        ...stateKeyframeB.objectStates[box.id],
        transform: {
          ...stateKeyframeB.objectStates[box.id].transform,
          position: { ...stateKeyframeB.objectStates[box.id].transform.position, x: 4 },
        },
      }

      const animation = compileStateKeyframesToAnimation([stateKeyframeA, stateKeyframeB], [box])
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

  it('空 stateKeyframes 数组返回空轨道与 0 时长', () => {
    const box = createPrimitiveObject('box', 'Box', pickDefaultColor(0))
    const animation = compileStateKeyframesToAnimation([], [box])
    expect(animation.tracks).toEqual([])
    expect(animation.duration).toBe(0)
  })

  it('单卡返回空轨道，时长等于该卡的绝对时间点', () => {
    const box = createPrimitiveObject('box', 'Box', pickDefaultColor(0))
    const stateKeyframe = createStateKeyframe([box], '卡1')
    stateKeyframe.time = 1.25
    const animation = compileStateKeyframesToAnimation([stateKeyframe], [box])
    expect(animation.tracks).toEqual([])
    expect(animation.duration).toBeCloseTo(1.25, 5)
  })

  describe('摄像机预设物化路径', () => {
    it('含 orbit 的过渡编译产物：x/y/z 轨道可被 sampleTrack 采样，中间时刻位置在圆弧上（到目标距离恒定，容差内）', () => {
      const target = { x: 0, y: 0, z: 0 }
      const startPosition = { x: 0, y: 2, z: 5 }
      const camera = createCameraObject('Camera', pickDefaultColor(2), { position: startPosition, target })

      const stateKeyframeA = createStateKeyframe([camera], '卡1')
      stateKeyframeA.time = 0
      stateKeyframeA.transitionDuration = 4
      const stateKeyframeB = createStateKeyframe([camera], '卡2')
      stateKeyframeB.time = stateKeyframeA.time + stateKeyframeA.transitionDuration
      const generated = createCameraPresetPath(
        { kind: 'orbit', degrees: 180, direction: 'cw' },
        startPosition,
        target,
      )
      stateKeyframeA.transition.perObject[camera.id] = { spatialPath: generated.path }
      stateKeyframeB.objectStates[camera.id].transform.position = generated.endPosition

      const animation = compileStateKeyframesToAnimation([stateKeyframeA, stateKeyframeB], [camera])
      expect(animation.spatialMotions).toHaveLength(1)
      const positionAt = (time: number) => sampleSpatialMotion(animation.spatialMotions[0], time)!

      const startDistance = Math.hypot(
        startPosition.x - target.x,
        startPosition.y - target.y,
        startPosition.z - target.z,
      )
      for (const time of [1, 2, 3]) {
        const { x, y, z } = positionAt(time)
        // 路径在运行时按弧长取点，点就在三次贝塞尔近似圆弧上（每段 ≤ 90° 时径向误差约万分之三）
        expect(Math.abs(Math.hypot(x - target.x, y - target.y, z - target.z) - startDistance)).toBeLessThan(0.01)
      }

      // 终点应落在环绕几何的 180° 落点（z ≈ -5），而不是 B 卡快照里未改动的原始机位（z ≈ 5）
      expect(positionAt(4).z).toBeCloseTo(-5, 1)
    })

    it('摄像机空间路径不会误伤 fov 变化：fov 仍走两点直插', () => {
      const target = { x: 0, y: 0, z: 0 }
      const camera = createCameraObject('Camera', pickDefaultColor(2), { position: { x: 0, y: 2, z: 5 }, target })

      const stateKeyframeA = createStateKeyframe([camera], '卡1')
      const stateKeyframeB = createStateKeyframe([camera], '卡2')
      stateKeyframeB.time = stateKeyframeA.time + stateKeyframeA.transitionDuration
      const generated = createCameraPresetPath(
        { kind: 'dollyIn', distanceRatio: 0.5 },
        stateKeyframeA.objectStates[camera.id].transform.position,
        target,
      )
      stateKeyframeA.transition.perObject[camera.id] = { spatialPath: generated.path }
      stateKeyframeB.objectStates[camera.id].transform.position = generated.endPosition
      stateKeyframeB.objectStates[camera.id] = { ...stateKeyframeB.objectStates[camera.id], fov: 70 }

      const animation = compileStateKeyframesToAnimation([stateKeyframeA, stateKeyframeB], [camera])
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

    const stateKeyframe1 = createStateKeyframe([box, character, camera], '卡1')
    stateKeyframe1.time = 0.5
    stateKeyframe1.transitionDuration = 1

    const stateKeyframe2 = createStateKeyframe([box, character, camera], '卡2', null, 2)
    stateKeyframe2.objectStates[camera.id] = {
      ...stateKeyframe2.objectStates[camera.id],
      transform: {
        ...stateKeyframe2.objectStates[camera.id].transform,
        position: { ...stateKeyframe2.objectStates[camera.id].transform.position, x: 2 },
      },
      fov: 70,
    }
    const characterPose = stateKeyframe2.objectStates[character.id].pose
    if (characterPose) {
      stateKeyframe2.objectStates[character.id] = {
        ...stateKeyframe2.objectStates[character.id],
        pose: { ...characterPose, joints: { ...characterPose.joints, head: { x: 10, y: 0, z: 0 } } },
      }
    }
    // 模拟"对象在该卡缺快照"（后加入场景的对象未被这张卡捕获）
    delete stateKeyframe2.objectStates[box.id]

    const animation = compileStateKeyframesToAnimation([stateKeyframe1, stateKeyframe2], [box, character, camera])

    expect(animation.tracks.length).toBeGreaterThan(0)
    for (const track of animation.tracks) {
      expect(getAnimatablePropByPath(track.propertyPath)).toBeDefined()
      expect(track.objectId).not.toBe(box.id)
    }
  })
})

describe('buildStateKeyframeTimeline 强制硬切（重要记录 005）', () => {
  it('相邻两卡机位不同时，布点保留真实区间时长（硬切改由编译产物的 hold 缓动在区间末端表达），原始 transitionDuration 不被改写', () => {
    const stateKeyframeA = createStateKeyframe([], '卡1', 'camera-a')
    const stateKeyframeB = createStateKeyframe([], '卡2', 'camera-b')
    stateKeyframeB.time = 3
    stateKeyframeA.time = 1
    stateKeyframeA.transitionDuration = 2

    const timeline = buildStateKeyframeTimeline([stateKeyframeA, stateKeyframeB])
    expect(timeline[0]).toEqual({ holdStart: 1, transitionStart: 1, transitionEnd: 3 })
    expect(stateKeyframeA.transitionDuration).toBe(2)
  })

  it('未指定机位的卡（cameraId 为 null）不触发强制硬切，行为与改动前一致', () => {
    const stateKeyframeA = createStateKeyframe([], '卡1')
    const stateKeyframeB = createStateKeyframe([], '卡2')
    stateKeyframeB.time = 3
    stateKeyframeA.time = 1
    stateKeyframeA.transitionDuration = 2

    const timeline = buildStateKeyframeTimeline([stateKeyframeA, stateKeyframeB])
    expect(timeline[0]).toEqual({ holdStart: 1, transitionStart: 1, transitionEnd: 3 })
  })

  it('机位相同的相邻卡保留真实过渡时长', () => {
    const stateKeyframeA = createStateKeyframe([], '卡1', 'camera-a')
    const stateKeyframeB = createStateKeyframe([], '卡2', 'camera-a')
    stateKeyframeB.time = 3
    stateKeyframeA.time = 1
    stateKeyframeA.transitionDuration = 2

    const timeline = buildStateKeyframeTimeline([stateKeyframeA, stateKeyframeB])
    expect(timeline[0]).toEqual({ holdStart: 1, transitionStart: 1, transitionEnd: 3 })
  })

  it('机位不同的强制硬切编译为 hold 缓动：区间内保持起点值，到区间末端直接跳变到目标值', () => {
    const camera = createCameraObject('摄像机01', pickDefaultColor(0))
    const stateKeyframeA = createStateKeyframe([camera], '卡1', 'camera-a')
    const stateKeyframeB = createStateKeyframe([camera], '卡2', 'camera-b')
    stateKeyframeB.time = 3
    stateKeyframeA.time = 1
    stateKeyframeA.transitionDuration = 2

    stateKeyframeB.objectStates[camera.id] = {
      ...stateKeyframeB.objectStates[camera.id],
      transform: {
        ...stateKeyframeB.objectStates[camera.id].transform,
        position: { ...stateKeyframeB.objectStates[camera.id].transform.position, x: 5 },
      },
    }

    const animation = compileStateKeyframesToAnimation([stateKeyframeA, stateKeyframeB], [camera])
    const positionXTrack = animation.tracks.find(
      (track) => track.objectId === camera.id && track.propertyPath === 'transform.position.x',
    )
    expect(positionXTrack).toBeDefined()
    // 硬切段：过渡起点关键帧保持 A 值且缓动为 hold，目标值只在区间末端（=3）出现
    const startKeyframe = positionXTrack!.keyframes.find((kf) => Math.abs(kf.time - 1) < 1e-6)
    expect(startKeyframe).toBeDefined()
    expect(startKeyframe!.value).toBe(0)
    expect(startKeyframe!.easing).toBe('hold')
    const endKeyframe = positionXTrack!.keyframes.find((kf) => Math.abs(kf.time - 3) < 1e-6)
    expect(endKeyframe).toBeDefined()
    expect(endKeyframe!.value).toBe(5)
    // 采样验证：区间内不插值，末端才跳变
    expect(sampleTrack(positionXTrack!, 2.9, 'scalar')).toBe(0)
    expect(sampleTrack(positionXTrack!, 3, 'scalar')).toBe(5)
  })
})
