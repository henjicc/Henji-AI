import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'

import { composeCameraStageShotCapability } from '@/core/application-control/domains/cameraStage/cameraStageShotApplicationCapabilities'
import { CAMERA_STAGE_SHOT_SIZES } from '@/core/application-control/domains/cameraStage/cameraStageShotSchemas'
import { createCharacterObject, createPrimitiveObject, pickDefaultColor } from '../domain/sceneDefaults'
import type { StageObject } from '../domain/sceneTypes'
import { axisNormalFor, axisSideOf, composeShot, ShotCompositionError, type ShotSpec } from './shotComposition'
import { foregroundEdge, shotObstacles, shotSubjectFromObject } from './shotGeometry'

function character(name: string, x: number, z: number, yaw: number): StageObject {
  const object = createCharacterObject(name, pickDefaultColor(1))
  object.transform.position = { x, y: 0, z }
  object.transform.rotation = { x: 0, y: yaw, z: 0 }
  return object
}

function spec(objects: StageObject[], overrides: Partial<ShotSpec>): ShotSpec {
  return {
    kind: 'single', subjects: [], size: 'medium', position: 'center', angle: 'eye_level', lens: 'standard', aspect: 16 / 9,
    currentPosition: new Vector3(0, 1.6, 6), axisNormal: null, avoidOcclusion: true, obstacles: shotObstacles(objects), ...overrides,
  }
}

describe('按构图意图定机位', () => {
  it('每种景别读回的景别与请求一致，三分法位置与角度也对得上', () => {
    const hero = character('主角', 0, 0, 0)
    const subject = shotSubjectFromObject(hero)
    for (const size of CAMERA_STAGE_SHOT_SIZES) {
      const solved = composeShot(spec([hero], { subjects: [subject], size }))
      const read = solved.readback.subjects[0]
      expect(read.shotSize, size).toBe(size)
      expect(read.inFrame, size).toBe(true)
      expect(solved.readback.angle, size).toBe('eye_level')
      expect(solved.camera.rotation.z).toBe(0)
    }
    const left = composeShot(spec([hero], { subjects: [subject], position: 'left' })).readback.subjects[0]
    expect(left.center!.x).toBeCloseTo(1 / 3, 1)
    expect(left.horizontal).toBe('left')
    for (const angle of ['high', 'low', 'birds_eye'] as const) {
      const solved = composeShot(spec([hero], { subjects: [subject], size: 'full', angle }))
      expect(solved.readback.angle, angle).toBe(angle)
      expect(solved.readback.subjects[0].shotSize, angle).toBe('full')
    }
    // 广角离得近、长焦离得远，景别不变。
    const wide = composeShot(spec([hero], { subjects: [subject], lens: 'wide' }))
    const tele = composeShot(spec([hero], { subjects: [subject], lens: 'telephoto' }))
    expect(wide.camera.position.distanceTo(subject.base)).toBeLessThan(tele.camera.position.distanceTo(subject.base) / 2)
    expect(tele.readback.subjects[0].shotSize).toBe('medium')
  })

  it('3/4 侧面自动按视线留空：人朝画面左看就站右三分线', () => {
    const hero = character('主角', 0, 0, 0)
    const solved = composeShot(spec([hero], { subjects: [shotSubjectFromObject(hero)], position: 'auto', view: 'front_left' }))
    expect(solved.readback.subjects[0].horizontal).toBe('right')
    expect(solved.readback.subjects[0].lookRoom).toBe('open')
  })

  it('过肩正反打守在轴线同一侧，被拍者在三分线上，前景那人在另一边', () => {
    const a = character('甲', -0.6, 0, 90)
    const b = character('乙', 0.6, 0, -90)
    const subjects = [shotSubjectFromObject(a), shotSubjectFromObject(b)]
    const side = axisSideOf(new Vector3(0, 1.6, 6), subjects)
    const axisNormal = axisNormalFor(subjects, side)
    const forward = composeShot(spec([a, b], { kind: 'over_shoulder', subjects, size: 'close', lens: 'telephoto', axisNormal }))
    const reverse = composeShot(spec([a, b], { kind: 'over_shoulder', subjects: [subjects[1], subjects[0]], size: 'close', lens: 'telephoto', axisNormal }))
    for (const [shot, foreground, target] of [[forward, '甲', '乙'], [reverse, '乙', '甲']] as const) {
      const fg = shot.readback.subjects.find((item) => item.name === foreground)!
      const main = shot.readback.subjects.find((item) => item.name === target)!
      expect(main.keyVisible).toBe(true)
      expect(main.shotSize).toBe('close')
      expect(Math.abs(main.center!.x - 0.5)).toBeCloseTo(1 / 6, 1)
      expect(Math.sign(fg.center!.x - 0.5)).toBe(-Math.sign(main.center!.x - 0.5))
      expect(axisSideOf(shot.camera.position, subjects)).toBe(side)
      expect(shot.camera.position.distanceTo(shotSubjectFromObject(foreground === '甲' ? a : b).base.clone().setY(1.6))).toBeLessThan(1.6)
    }
    // 同一侧轴线：正打里甲在左，反打里甲仍在左。
    const leftName = (shot: typeof forward) => [...shot.readback.subjects].sort((l, r) => l.center!.x - r.center!.x)[0].name
    expect(leftName(forward)).toBe(leftName(reverse))

    // 双人镜头的俯仰按从被拍者看的仰角求，读回与要的一致；过肩只用平视，要俯仰时改道。
    for (const angle of ['high', 'low', 'birds_eye'] as const) {
      const shot = composeShot(spec([a, b], { kind: 'two_shot', subjects, angle, axisNormal }))
      expect(shot.readback.angle, angle).toBe(angle)
      expect(axisSideOf(shot.camera.position, subjects), angle).toBe(side)
    }
    const refused = composeCameraStageShotCapability.inputSchema.safeParse({
      documentId: 'doc', cameraId: 'camera', relation: 'over_shoulder', subjects: [{ objectId: 'a' }, { objectId: 'b' }], angle: 'high',
    })
    expect(refused.success).toBe(false)
    expect(refused.error?.issues[0].message).toContain('two_shot')
  })

  it('过肩按两人间距求焦距：离得远换长焦、再远放宽景别，前景始终约占画宽三分之一且在机位前方', () => {
    const pair = (gap: number) => {
      const a = character('甲', -gap / 2, 0, 90)
      const b = character('乙', gap / 2, 0, -90)
      const subjects = [shotSubjectFromObject(a), shotSubjectFromObject(b)]
      const axisNormal = axisNormalFor(subjects, axisSideOf(new Vector3(0, 1.6, 6), subjects))
      return { subjects, request: spec([a, b], { kind: 'over_shoulder', subjects, size: 'close', lens: 'telephoto', axisNormal }) }
    }
    for (const gap of [0.6, 1.2, 2, 3, 6]) {
      const { subjects, request } = pair(gap)
      const shot = composeShot(request)
      const main = shot.readback.subjects[1]
      expect(main.keyVisible, `${gap}`).toBe(true)
      expect(main.shotSize, `${gap}`).toBe(shot.size)
      // 前景约占画宽 0.3；两人挨得很近时被拍者站三分线，前景只能多挤进来一些。
      const edge = foregroundEdge(shot.camera, subjects[0])!
      if (gap >= 1.2) expect(edge, `${gap}`).toBeCloseTo(0.3, 1)
      else expect(edge, `${gap}`).toBeLessThanOrEqual(0.45)
      // 机位在前景那人身后：离他比离被拍者近。
      const fgEye = subjects[0].base.clone().setY(subjects[0].height * 0.936)
      expect(shot.camera.position.distanceTo(fgEye), `${gap}`).toBeLessThan(shot.camera.position.distanceTo(subjects[1].base.clone().setY(1.6)))
      if (gap >= 2) {
        expect(shot.adjusted?.reasons, `${gap}`).toContain('separation')
        expect(shot.focalLength, `${gap}`).toBeGreaterThan(85)
        expect(shot.adjusted?.summary, `${gap}`).toContain('相距')
      }
    }
    // 两米：近景换长焦就够；三米：200mm 内拍不了近景，放宽到中近景。
    expect(composeShot(pair(2).request).size).toBe('close')
    const far = composeShot(pair(3).request)
    expect(far.size).toBe('medium_close')
    expect(far.adjusted?.size).toBe('medium_close')
    expect(far.adjusted?.summary).toContain('放宽')

    let refused: unknown
    try { composeShot(pair(40).request) } catch (error) { refused = error }
    expect(refused).toBeInstanceOf(ShotCompositionError)
    expect((refused as Error).message).toContain('相距 40 米')
    expect((refused as Error).message).not.toContain('太近')
  })

  it('意图机位被挡时绕开并报告挡住它的是谁；不避让时如实报告遮挡', () => {
    const hero = character('主角', 0, 0, 0)
    const wall = createPrimitiveObject('box', '墙', pickDefaultColor(2))
    wall.transform.position = { x: 0, y: 1.5, z: 2 }
    wall.transform.scale = { x: 2, y: 3, z: 0.3 }
    const request = spec([hero, wall], { subjects: [shotSubjectFromObject(hero)], view: 'front', size: 'full' })
    const avoided = composeShot(request)
    expect(avoided.adjusted?.reasons).toContain('occlusion')
    expect(avoided.adjusted?.blockedBy).toContain('墙')
    expect(avoided.readback.subjects[0].keyVisible).toBe(true)
    expect(avoided.readback.subjects[0].visibleFraction).toBeGreaterThanOrEqual(0.7)

    const kept = composeShot({ ...request, avoidOcclusion: false })
    expect(kept.adjusted).toBeNull()
    expect(kept.readback.subjects[0].keyVisible).toBe(false)
    expect(kept.readback.subjects[0].occludedBy.map((item) => item.name)).toContain('墙')
  })
})
