import { expect, it } from 'vitest'

import { cameraStageApplicationService } from '@/features/cameraStage/application/cameraStageApplicationService'
import { createDefaultAnimation } from '@/features/cameraStage/domain/animationTypes'
import { buildRenderCameraSchedule, resolveRenderCameraAt } from '@/features/cameraStage/domain/renderCameraSchedule'
import { createCameraObject, createCharacterObject, createDefaultSceneSettings, pickDefaultColor } from '@/features/cameraStage/domain/sceneDefaults'
import { createStateKeyframe } from '@/features/cameraStage/domain/stateKeyframeTypes'
import { applyAnimationAtTime } from '@/features/cameraStage/store/playbackSampling'
import { createApplicationHarness } from './applicationHarness'
import { loadCameraStageTestProject } from './cameraStageProjectFixture'

interface CoverageResult {
  coverageId: string
  setups: Array<{ cameraId: string; role: string; subjectIds: string[]; axisSide: string | null; visibleSpans: Array<{ startTime: number; endTime: number }> }>
}
interface EditResult {
  shots: Array<{ index: number; startTime: number; endTime: number; cameraId: string; role: string | null; primarySubjectId: string | null }>
  violations: Array<{ rule: string; severity: string; shotIndexes: number[] }>
  passedRules: string[]
}

/** 经正式公共入口（与 MCP 同一条执行链）：两人对话带一次走动和转身，布置覆盖、剪辑、检查，并核对切机位不碰人物运动。 */
it('对话覆盖守同一侧轴线；剪辑先建立、换人说话切到说话人、无越轴跳切；切机位不改变走位；检查找出人为插入的跳切', async () => {
  const camera = createCameraObject('主摄影机', pickDefaultColor(0))
  camera.transform.position = { x: -1, y: 1.6, z: 9 }
  const jia = createCharacterObject('甲', pickDefaultColor(1))
  jia.transform.position = { x: -6, y: 0, z: 0 }
  jia.transform.rotation = { x: 0, y: 90, z: 0 }
  const yi = createCharacterObject('乙', pickDefaultColor(2))
  yi.transform.position = { x: 1, y: 0, z: 0 }
  yi.transform.rotation = { x: 0, y: 90, z: 0 }
  const objects = [camera, jia, yi]
  const documentId = 'coverage-scene'
  await loadCameraStageTestProject({ objects, activeCameraId: camera.id, animation: createDefaultAnimation(),
    sceneSettings: createDefaultSceneSettings(), stateKeyframes: [createStateKeyframe(objects, '起点', 0)] }, { id: documentId, name: '对话' })
  const app = createApplicationHarness()
  try {
    await app.requireResult('block_camera_stage_character', { documentId, characterId: jia.id, beats: [{ kind: 'move', to: { objectId: yi.id, side: 'back', distance: 1 } }] })
    await app.requireResult('block_camera_stage_character', { documentId, characterId: yi.id, startTime: 2.5, beats: [{ kind: 'turn', toward: { objectId: jia.id } }] })
    const lines = [
      { speakerId: jia.id, startTime: 4.5, endTime: 7.5 },
      { speakerId: yi.id, startTime: 8, endTime: 11 },
      { speakerId: jia.id, startTime: 11.5, endTime: 14 },
    ]
    const coverage = await app.requireResult('cover_camera_stage_scene', {
      documentId, subjects: [jia.id, yi.id], startTime: 0, endTime: 15, lines, shots: ['establishing', 'master', 'over_shoulder', 'single', 'reaction'],
    }) as unknown as CoverageResult
    expect(coverage.setups.map((setup) => setup.role)).toEqual(['establishing', 'master', 'over_shoulder', 'over_shoulder', 'single', 'single', 'reaction', 'reaction'])
    expect(coverage.setups.filter((setup) => setup.axisSide === 'crossed')).toEqual([])
    const reverse = coverage.setups.filter((setup) => setup.role === 'over_shoulder')
    for (const setup of reverse) expect(setup.visibleSpans.some((span) => span.startTime <= 8 && span.endTime >= 11)).toBe(true)

    const jiaBefore = applyAnimationAtTime((await cameraStageApplicationService.readSnapshot(documentId)).objects, (await cameraStageApplicationService.readSnapshot(documentId)).animation, 1.5)
      .find((object) => object.id === jia.id)!.transform.position
    const edit = await app.requireResult('cut_camera_stage_coverage', { documentId, coverageId: coverage.coverageId, pace: 'medium' }) as unknown as EditResult
    expect(edit.shots[0].role).toBe('establishing')
    expect(edit.violations.filter((violation) => violation.severity === 'error')).toEqual([])
    expect(edit.passedRules).toEqual(expect.arrayContaining(['axis', 'jump_cut', 'speaker', 'establishing']))
    expect(edit.shots.length).toBeGreaterThanOrEqual(4)

    // 真相源：机位轨上乙开口后那一刻在拍的机位拍得到乙；切机位前后甲走位的位置一模一样。
    const snapshot = await cameraStageApplicationService.readSnapshot(documentId)
    const live = resolveRenderCameraAt(buildRenderCameraSchedule(snapshot.cameraCuts, snapshot.activeCameraId), 8.6)
    const liveSetup = coverage.setups.find((setup) => setup.cameraId === live)!
    expect(['master', 'establishing'].includes(liveSetup.role) || liveSetup.subjectIds.at(-1) === yi.id || (liveSetup.role !== 'over_shoulder' && liveSetup.subjectIds[0] === yi.id)).toBe(true)
    const jiaAfter = applyAnimationAtTime(snapshot.objects, snapshot.animation, 1.5).find((object) => object.id === jia.id)!.transform.position
    expect(jiaAfter).toEqual(jiaBefore)

    // 人为插入同一人的近景接特写（同一侧、夹角很小、景别只差一档），检查要报跳切并点名这两镜。
    const single = coverage.setups.find((setup) => setup.role === 'single' && setup.subjectIds[0] === jia.id)!
    const reaction = coverage.setups.find((setup) => setup.role === 'reaction' && setup.subjectIds[0] === jia.id)!
    await app.requireResult('change_application_entities', { summary: '插入两个切点', changes: [{
      kind: 'create_items', parent: { kind: 'camera_stage.scene', id: documentId }, entityType: 'camera_stage.camera_cut',
      items: [
        { properties: { 'camera_stage.camera_cut.time': 12, 'camera_stage.camera_cut.camera_ref': { kind: 'camera_stage.camera', id: `${documentId}:${single.cameraId}` } } },
        { properties: { 'camera_stage.camera_cut.time': 13.5, 'camera_stage.camera_cut.camera_ref': { kind: 'camera_stage.camera', id: `${documentId}:${reaction.cameraId}` } } },
      ],
    }] })
    const checked = await app.requireResult('check_camera_stage_edit', { documentId, coverageId: coverage.coverageId, pace: 'medium' }) as unknown as EditResult
    const jump = checked.violations.find((violation) => violation.rule === 'jump_cut')
    expect(jump).toBeDefined()
    expect(jump!.shotIndexes.map((index) => checked.shots[index].cameraId)).toEqual([single.cameraId, reaction.cameraId])
  } finally { app.dispose() }
})
