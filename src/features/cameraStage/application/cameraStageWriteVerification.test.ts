import { expect, it } from 'vitest'
import { loadCameraStageTestProject } from '@/tests/cameraStageProjectFixture'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { createDefaultAnimation } from '../domain/animationTypes'
import { createCameraObject, createDefaultSceneSettings, pickDefaultColor } from '../domain/sceneDefaults'
import { createStateKeyframe } from '../domain/stateKeyframeTypes'
import { cameraStageApplicationService } from './cameraStageApplicationService'

it('A：放置、复制、删除与运镜经正式公共入口回读 verified，删除后仍可继续修改同文档', async () => {
  const camera = createCameraObject('机位', pickDefaultColor(0))
  camera.transform.position = { x: 0, y: 2, z: 10 }
  camera.lookAt = { mode: 'manual', target: { x: 0, y: 2, z: 0 } }
  const documentId = 't191-scene'
  await loadCameraStageTestProject({ objects: [camera], activeCameraId: camera.id, animation: createDefaultAnimation(),
    sceneSettings: createDefaultSceneSettings(), stateKeyframes: [createStateKeyframe([camera], '起点', camera.id, 0)] }, { id: documentId, name: '核对场景' })
  const app = createApplicationHarness()
  try {
    const place = () => app.requireResult('place_camera_stage_object', { documentId, objectType: 'primitive', primitiveKind: 'sphere', reusePolicy: 'require_new', placement: { position: { x: 3, y: 0, z: 0 }, allowOverlap: true } })
    const placed = await place()
    expect(placed.resultingRevisions).toEqual({ camera_stage: expect.any(Number) })
    const ref = (placed.resultRefs as Array<{ kind: string; id: string }>).find(value => value.kind === 'camera_stage.object')!
    const objectId = ref.id.slice(documentId.length + 1)
    expect((await cameraStageApplicationService.readSnapshot(documentId)).objects.find(object => object.id === objectId)?.transform.position).toEqual({ x: 3, y: 0, z: 0 })
    const copied = await app.requireResult('duplicate_camera_stage_object', { documentId, objectId })
    const copyRef = { kind: 'camera_stage.object', id: `${documentId}:${copied.objectId}` }
    const baseline = await app.read(copyRef)
    expect(baseline.revisions).toEqual({ camera_stage: expect.any(Number) })
    const documentBaseline = await app.read({ kind: 'camera_stage.document', id: documentId })
    expect(documentBaseline.revisions).toEqual(baseline.revisions)
    expect(baseline.scopeRevisions).toHaveProperty('camera_stage', (baseline.revisions as Record<string, number>).camera_stage)
    const deleted = await app.requireResult('delete_camera_stage_object', { documentId, objectId: copied.objectId }, baseline.revisions as Record<string, number>)
    expect((await cameraStageApplicationService.readSnapshot(documentId)).objects.some(object => object.id === copied.objectId)).toBe(false)
    const continued = await place()
    const staleWrite = await app.call('place_camera_stage_object', { documentId, objectType: 'primitive', primitiveKind: 'sphere' }, baseline.revisions as Record<string, number>)
    expect(staleWrite).toMatchObject({ ok: false, error: { code: 'CONFLICT', recoverable: true } })
    const legacyWrite = await app.call('place_camera_stage_object', { documentId, objectType: 'primitive', primitiveKind: 'sphere' }, { toolbox: (baseline.revisions as Record<string, number>).camera_stage })
    expect(legacyWrite).toMatchObject({ ok: false, error: { code: 'CONFLICT', recoverable: true } })
    const motion = await app.requireResult('apply_camera_stage_camera_move', { documentId, cameraId: camera.id, targetObjectId: objectId, move: { kind: 'orbit', degrees: 90, direction: 'cw' }, duration: 2 })
    expect((await cameraStageApplicationService.readSnapshot(documentId)).stateKeyframes).toHaveLength(2)
    for (const result of [placed, copied, deleted, continued, motion]) {
      expect(result.verification).toMatchObject({ verified: true })
      expect(result).not.toHaveProperty('baseRevision')
    }
  } finally { app.dispose() }
})
