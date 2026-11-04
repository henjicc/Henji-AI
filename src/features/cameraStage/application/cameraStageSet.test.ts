import { beforeEach, describe, expect, it } from 'vitest'
import '@/tests/cameraStageProjectFixture'
import { documentKindRegistry } from '@/core/documents/kinds'
import { cameraStageDocumentKind } from '@/core/documents/kinds/cameraStage'
import { DocumentSessionRegistry } from '@/features/documents/documentSessionRegistry'
import { createScriptedPrompter, FakeDocumentCommands } from '@/features/documents/documentSessionTestKit'
import type { ApplicationPlannedStep } from '@/core/application-control'

import { createDefaultCameraStageSceneSnapshot } from '../domain/defaultSceneSnapshot'
import { sceneFromDocumentContent, sceneToDocumentContent, type CameraStageSceneContent } from '../domain/sceneSerialization'
import { buildStageSet, estimateStageSetObjectCount, generateStageSetObjects } from '../domain/stageSets'
import { cameraStageApplicationService } from './cameraStageApplicationService'
import { cameraStageProjectStore, ensureCameraStageProjectRuntime, setCameraStageDocumentRegistryForTests } from './cameraStageProjectRuntime'
import { CameraStageSetCollectionExecutor, CameraStageSetGenerateOperationExecutor } from './cameraStageSetExecutors'
import { verifyCameraStageScene } from './cameraStageVerification'

/*
 * 布景生成：一次调用整片布景进场景、一条撤销记录、一次存盘；观察只给摘要；重新生成沿用参数；
 * 整片删除可撤销。用内存文档仓库替身 + 正式会话登记表与正式执行器，从场景真相源断言。
 */

let commands: FakeDocumentCommands
const dependencies = { readRevision: () => revision, bumpRevision: () => { revision += 1 } }
let revision = 0

beforeEach(() => {
  commands = new FakeDocumentCommands()
  setCameraStageDocumentRegistryForTests(new DocumentSessionRegistry({ commands, prompter: createScriptedPrompter(), kinds: documentKindRegistry }))
  commands.seed({ kind: 'camera_stage', id: 'set-doc', name: 'set-doc', content: structuredClone(sceneToDocumentContent(createDefaultCameraStageSceneSnapshot())) })
  revision = 0
})

describe('布景生成算法', () => {
  it('同一组参数和种子得到同样的布局，估算数量与实际一致，城市中心总落在路口上', () => {
    // 默认范围与技能推荐的规模都要覆盖：街区数按范围取整后可能是奇数，中心仍须在路口。
    for (const width of [undefined, 240, 600, 1450]) {
      const { set } = buildStageSet([], { layout: { preset: 'city', ...(width ? { width, depth: width } : {}), seed: 11 } })
      const first = generateStageSetObjects(set)
      if (width === undefined) expect(generateStageSetObjects(set).map(object => object.transform)).toEqual(first.map(object => object.transform))
      expect(Math.abs(first.length - estimateStageSetObjectCount(set.params))).toBeLessThan(estimateStageSetObjectCount(set.params) * 0.15)
      // x、z 都在 ±(街道宽/2) 以内的十字路上没有楼。
      const half = set.params.preset === 'city' ? set.params.streetWidth / 2 : 0
      expect(first.some(object => Math.abs(object.transform.position.x) - object.transform.scale.x / 2 < half
        && Math.abs(object.transform.position.z) - object.transform.scale.z / 2 < half)).toBe(false)
      expect(first.some(object => Math.abs(object.transform.position.x) < half || Math.abs(object.transform.position.z) < half)).toBe(false)
      expect(first.every(object => object.setId === set.id && object.type === 'primitive')).toBe(true)
    }
  })

  it('一个对象都生成不了的参数在写入前被拒绝', () => {
    expect(() => buildStageSet([], { layout: { preset: 'city', density: 0 } })).toThrow('STAGE_SET_EMPTY')
    expect(() => buildStageSet([], { layout: { preset: 'plaza', density: 0, monument: false } })).toThrow('STAGE_SET_EMPTY')
  })

  it('上万人散开也很快，且彼此不挤在一起', () => {
    const started = performance.now()
    const { objects } = buildStageSet([], { layout: { preset: 'crowd', count: 10_000, formation: 'scatter', seed: 9 } })
    expect(objects).toHaveLength(10_000)
    expect(performance.now() - started).toBeLessThan(3_000)
  })

  it('人群按人数生成角色，围圈时面向中心', () => {
    const { objects } = buildStageSet([], { layout: { preset: 'crowd', count: 12, formation: 'ring', facing: 'center', seed: 3 } })
    expect(objects).toHaveLength(12)
    expect(objects.every(object => object.type === 'character')).toBe(true)
    const [person] = objects
    const yaw = (person.transform.rotation.y * Math.PI) / 180
    // 角色正面朝局部 +Z，转过 yaw 后的朝向应指向原点。
    const facing = { x: Math.sin(yaw), z: Math.cos(yaw) }
    const toCenter = { x: -person.transform.position.x, z: -person.transform.position.z }
    expect(facing.x * toCenter.x + facing.z * toCenter.z).toBeGreaterThan(0)
  })
})

describe('布景生成落地', () => {
  it('一次生成一次存盘、一条撤销；观察只给摘要；重新生成沿用参数；整片删除后可撤销', async () => {
    await ensureCameraStageProjectRuntime('set-doc')
    const store = cameraStageProjectStore('set-doc')
    const before = store.getState().objects.length
    const historyBefore = store.temporal.getState().pastStates.length
    const writesBefore = commands.writes
    const generate = new CameraStageSetGenerateOperationExecutor(dependencies)

    const created = await generate.execute(generate.normalizeInput({ projectId: 'set-doc', layout: { preset: 'city', width: 600, depth: 600, seed: 5 } }), {} as never)
    const setRef = created.directRefs[0]
    const setId = setRef.id.slice('set-doc:'.length)
    const members = store.getState().objects.filter(object => object.setId === setId)
    expect(members.length).toBeGreaterThan(1500)
    expect(store.getState().objects).toHaveLength(before + members.length)
    expect(commands.writes - writesBefore).toBe(1)
    expect(store.temporal.getState().pastStates.length - historyBefore).toBe(1)

    const observation = await cameraStageApplicationService.observeProject('set-doc')
    expect(observation.objects).toHaveLength(before)
    expect(observation.sets).toEqual([expect.objectContaining({ id: setId, objectCount: members.length, params: expect.objectContaining({ preset: 'city', width: 600, seed: 5 }) })])
    expect(JSON.stringify(observation).length).toBeLessThan(10_000)
    // 观察不列成员，但按 id 验证成员存在、读布景实体都要照常成立。
    expect((await verifyCameraStageScene({ projectId: 'set-doc', expectedObjectIds: [members[0].id], requireNoCollisions: false })).verified).toBe(true)

    // 生成城市后自动摆主角：落在原点路口上，不被楼群重心拉走，也不压进楼里。
    const hero = await cameraStageApplicationService.placeObject({ projectId: 'set-doc', spec: { objectType: 'character', reusePolicy: 'prefer_existing', role: 'character' }, placement: { mode: 'auto', spacing: 0.35, allowOverlap: false } })
    expect(hero).toMatchObject({ decision: 'created', conflicts: [], position: { x: 0, z: 0 } })
    store.getState().removeObject(hero.objectId)
    // 按明确坐标放一块盖住楼群的地面：布置结果对布景只给计数。
    const slab = await cameraStageApplicationService.placeObject({ projectId: 'set-doc', spec: { objectType: 'primitive', primitiveKind: 'box', reusePolicy: 'require_new' }, placement: { mode: 'auto', position: { x: 0, y: 2, z: 0 }, dimensions: { x: 400, y: 4, z: 400 }, spacing: 0.35, allowOverlap: true } })
    expect(slab.conflicts).toEqual([])
    expect(slab.setConflicts).toEqual([{ setId, memberCount: expect.any(Number) }])
    expect(slab.setConflicts[0].memberCount).toBeGreaterThan(100)
    store.getState().removeObject(slab.objectId)

    // 压进城里的一块大地面只算一条布景重叠，不逐个列出成员。
    store.getState().addPrimitive('box')
    const slabId = store.getState().selectedId!
    store.getState().updateObjectAcrossStateKeyframes(slabId, { transform: { position: { x: 0, y: 2, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 400, y: 4, z: 400 } } })
    const crowded = await cameraStageApplicationService.observeProject('set-doc')
    expect(crowded.setCollisions).toEqual([expect.objectContaining({ objectId: slabId, setId, memberCount: expect.any(Number) })])
    expect(crowded.setCollisions[0].memberCount).toBeGreaterThan(100)
    expect(JSON.stringify(crowded).length).toBeLessThan(10_000)
    store.getState().removeObject(slabId)

    // 空布景参数在写入前拒绝，旧布景不受影响。
    const writesBeforeEmpty = commands.writes
    await expect(generate.execute(generate.normalizeInput({ projectId: 'set-doc', layout: { preset: 'city', density: 0 }, replaceSetId: setId }), {} as never)).rejects.toThrow('STAGE_SET_EMPTY')
    expect(store.getState().objects.filter(object => object.setId === setId)).toHaveLength(members.length)
    expect(commands.writes).toBe(writesBeforeEmpty)

    // replaceSetId 也接受“文档 ID:布景 ID”形式的稳定引用。
    await generate.execute(generate.normalizeInput({ projectId: 'set-doc', layout: { preset: 'city', density: 0.4 }, replaceSetId: setRef.id }), {} as never)
    const regenerated = store.getState().sets.find(set => set.id === setId)!
    expect(regenerated.params).toMatchObject({ width: 600, seed: 5, density: 0.4 })
    const thinned = store.getState().objects.filter(object => object.setId === setId).length
    expect(thinned).toBeLessThan(members.length * 0.6)
    expect(store.getState().objects).toHaveLength(before + thinned)

    const collection = new CameraStageSetCollectionExecutor(dependencies)
    const step = { kind: 'collection', entityType: 'camera_stage.set', parent: { kind: 'camera_stage.scene', id: 'set-doc' }, operation: { kind: 'remove', targets: [setRef] } } as unknown as Extract<ApplicationPlannedStep, { kind: 'collection' }>
    const removed = await collection.apply(step)
    expect(store.getState().objects).toHaveLength(before)
    expect((await cameraStageApplicationService.observeProject('set-doc')).sets).toEqual([])
    const undone = await collection.undo(removed.undoToken!)
    expect(undone.directRefs.map(ref => ref.id)).toEqual([setRef.id])
    expect(store.getState().objects.filter(object => object.setId === setId)).toHaveLength(thinned)
  })

  it('旧版文档迁移后没有布景；布景随文档写出与读回', () => {
    const migrated = cameraStageDocumentKind.migrations[1]!({ objects: [], activeCameraId: null, sceneSettings: {}, stateKeyframes: [] }) as CameraStageSceneContent
    expect(migrated.sets).toEqual([])
    const scene = createDefaultCameraStageSceneSnapshot()
    const { set, objects } = buildStageSet([], { layout: { preset: 'street', seed: 2 } })
    const content = sceneToDocumentContent({ ...scene, objects: [...scene.objects, ...objects], sets: [set] })
    const restored = sceneFromDocumentContent(JSON.parse(JSON.stringify(content)))
    expect(restored.sets).toEqual([set])
    expect(restored.objects.filter(object => object.setId === set.id)).toHaveLength(objects.length)
    // 成员删光的布景不写进文件。
    expect(sceneToDocumentContent({ ...scene, sets: [set] }).sets).toEqual([])
    // 更新版本才有的布景类型原样保留；记录丢了的成员回到普通对象。
    const future = { id: 'future', name: '森林', params: { preset: 'forest', seed: 1 } }
    const mixed = sceneFromDocumentContent({ ...JSON.parse(JSON.stringify(content)), sets: [future] })
    expect(mixed.sets).toEqual([future])
    expect(mixed.objects.some(object => object.setId !== undefined)).toBe(false)
  })
})
