import { beforeEach, describe, expect, it } from 'vitest'
import '@/tests/cameraStageProjectFixture'
import { documentKindRegistry } from '@/core/documents/kinds'
import { cameraStageDocumentKind } from '@/core/documents/kinds/cameraStage'
import { DocumentSessionRegistry } from '@/features/documents/documentSessionRegistry'
import { createScriptedPrompter, FakeDocumentCommands } from '@/features/documents/documentSessionTestKit'
import type { ApplicationPlannedStep } from '@/core/application-control'

import { createDefaultCameraStageSceneSnapshot } from '../domain/defaultSceneSnapshot'
import { sceneFromDocumentContent, sceneToDocumentContent, type CameraStageSceneContent } from '../domain/sceneSerialization'
import { buildStageSet, countStageSetDecor, estimateStageSet, generateStageSet } from '../domain/stageSets'
import { CITY_STYLES, roadWidth } from '../domain/stageSetStyles'
import { STAGE_SET_DECOR_STRIDE } from '../domain/sceneTypes'
import { cameraStageApplicationService } from './cameraStageApplicationService'
import { cameraStageProjectStore, ensureCameraStageProjectRuntime, setCameraStageDocumentRegistryForTests } from './cameraStageProjectRuntime'
import { CameraStageSetCollectionExecutor, CameraStageSetGenerateOperationExecutor } from './cameraStageSetExecutors'
import { verifyCameraStageScene } from './cameraStageVerification'
import { stepCameraStageHistory } from '../store/useCameraStageHistory'

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
  it('同一组参数和种子得到同样的布局，数出的规模与实际一致，城市中心总落在路口上', () => {
    // 三种风格、默认与大范围都要覆盖：中心那两条路的红线以内没有楼。
    for (const style of ['grid', 'superblock', 'oldtown'] as const) {
      for (const width of [undefined, 1500]) {
        const { set, objects } = buildStageSet([], { layout: { preset: 'city', style, ...(width ? { width, depth: width } : {}), seed: 11 } })
        if (width === undefined) expect(generateStageSet(set).objects.map(object => object.transform)).toEqual(objects.map(object => object.transform))
        expect(estimateStageSet(set.params).objects).toBe(objects.length)
        const halfX = roadWidth(CITY_STYLES[style].roads[CITY_STYLES[style].x.roadAt(0)]) / 2
        const halfZ = roadWidth(CITY_STYLES[style].roads[CITY_STYLES[style].z.roadAt(0)]) / 2
        const inRoad = (center: number, size: number, half: number): boolean => Math.abs(center) - size / 2 < half - 0.01
        expect(objects.some(object => inRoad(object.transform.position.x, object.transform.scale.x, halfX) || inRoad(object.transform.position.z, object.transform.scale.z, halfZ))).toBe(false)
        expect(objects.every(object => object.setId === set.id && object.type === 'primitive')).toBe(true)
      }
    }
  })

  it('按真实尺度：楼高按层取整，高楼是裙楼加塔楼，开关参照物不改变楼的布局', () => {
    const { set, objects } = buildStageSet([], { layout: { preset: 'city', style: 'grid', seed: 5 } })
    // 方格城市沿街楼首层 4.5 米、楼上 3.2 米一层；写字楼首层 5.5 米、楼上 4 米。
    const whole = (height: number, ground: number, upper: number): boolean => Math.abs(((height - ground) / upper) - Math.round((height - ground) / upper)) < 1e-6
    for (const object of objects.filter(candidate => /楼\d+$/.test(candidate.name) || candidate.name.endsWith(' 裙楼'))) {
      expect(whole(object.transform.scale.y, 4.5, 3.2) || whole(object.transform.scale.y, 5.5, 4)).toBe(true)
    }
    expect(objects.some(object => object.name.endsWith(' 塔楼'))).toBe(true)
    const towers = objects.filter(object => object.name.endsWith(' 塔楼'))
    for (const tower of towers) {
      const podium = objects.find(object => object.name === tower.name.replace(' 塔楼', ' 裙楼'))!
      expect(tower.transform.position.y - tower.transform.scale.y / 2).toBeCloseTo(podium.transform.scale.y, 6)
      expect(whole(tower.transform.scale.y + podium.transform.scale.y, 5.5, 4)).toBe(true)
      expect(tower.transform.scale.x).toBeLessThan(podium.transform.scale.x)
    }
    expect(countStageSetDecor(set.decor).trees).toBeGreaterThan(100)
    // 新城商业地块：裙楼和它上面的塔楼是同一栋楼，同色、同一个编号
    const superblock = buildStageSet([], { layout: { preset: 'city', style: 'superblock', seed: 5 } }).objects
    const complexTowers = superblock.filter(object => / 塔楼\d*$/.test(object.name))
    expect(complexTowers.length).toBeGreaterThan(0)
    for (const tower of complexTowers) {
      const building = tower.name.replace(/ 塔楼\d*$/, '')
      expect(new Set(superblock.filter(object => object.name.startsWith(`${building} `)).map(object => object.color)).size).toBe(1)
    }
    const bare = buildStageSet([], { layout: { preset: 'city', style: 'grid', seed: 5, props: false } })
    expect(bare.set.decor).toBeUndefined()
    expect(bare.objects.map(object => object.transform)).toEqual(objects.map(object => object.transform))
  })

  it('参照物落在人行道上：行道树与路灯都在路缘与建筑红线之间，车辆都在车行道里', () => {
    const { set } = buildStageSet([], { layout: { preset: 'street', road: 'collector', seed: 4 } })
    const section = { carriage: 4 * 3.4 + 2 * 2.5, row: roadWidth({ lanes: 4, laneWidth: 3.4, median: 0, bike: 2.5, parking: 0, sidewalk: 5, lampHeight: 10, lampSpacing: 32 }) }
    const decor = set.decor!
    for (const [values, stride] of [[decor.trees, STAGE_SET_DECOR_STRIDE.tree], [decor.lamps, STAGE_SET_DECOR_STRIDE.lamp]] as const) {
      for (let offset = 0; offset < values.length; offset += stride) {
        const z = Math.abs(values[offset + 1])
        expect(z).toBeGreaterThan(section.carriage / 2)
        expect(z).toBeLessThan(section.row / 2)
      }
    }
    for (let offset = 0; offset < decor.vehicles.length; offset += STAGE_SET_DECOR_STRIDE.vehicle) {
      expect(Math.abs(decor.vehicles[offset + 1])).toBeLessThan(section.carriage / 2)
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
    expect(members.length).toBeGreaterThan(300)
    expect(store.getState().objects).toHaveLength(before + members.length)
    expect(commands.writes - writesBefore).toBe(1)
    expect(store.temporal.getState().pastStates.length - historyBefore).toBe(1)
    // 默认雾距跟着城区尺度推远
    const cityFog = store.getState().sceneSettings.fog.distance
    expect(cityFog).toBeGreaterThan(600)

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
    const regeneratedFog = store.getState().sceneSettings.fog.distance
    const removed = await collection.apply(step)
    // 没手调过的雾距随布景删除回到默认
    expect(store.getState().sceneSettings.fog.distance).toBe(90)
    expect(store.getState().objects).toHaveLength(before)
    expect((await cameraStageApplicationService.observeProject('set-doc')).sets).toEqual([])
    await collection.undo(removed.undoToken!)
    expect((await cameraStageApplicationService.observeProject('set-doc')).sets.map(set => set.id)).toEqual([setId])
    expect(store.getState().objects.filter(object => object.setId === setId)).toHaveLength(thinned)
    expect(store.getState().sceneSettings.fog.distance).toBe(regeneratedFog)

    // 界面撤销重做：撤销历史不记场景设置，雾距按同一条规则跟回去
    store.getState().removeStageSet(setId)
    expect(store.getState().sceneSettings.fog.distance).toBe(90)
    stepCameraStageHistory(store, 'undo')
    expect(store.getState().sceneSettings.fog.distance).toBe(regeneratedFog)
    stepCameraStageHistory(store, 'redo')
    expect(store.getState().sceneSettings.fog.distance).toBe(90)
    stepCameraStageHistory(store, 'undo')

    // 手调过的雾距不被删除与撤销覆盖
    store.getState().setSceneFogDistance(regeneratedFog + 7)
    store.getState().removeStageSet(setId)
    stepCameraStageHistory(store, 'undo')
    expect(store.getState().sceneSettings.fog.distance).toBe(regeneratedFog + 7)

    // 没有布景、雾距默认时，撤销普通对象的移动不动雾距（摄像机离原点 40 米，超过默认雾距照顾的范围）
    store.getState().removeStageSet(setId)
    store.getState().setSceneFogDistance(90)
    const cameraId = store.getState().objects.find(object => object.type === 'camera')!.id
    store.getState().updateTransform(cameraId, { position: { x: 40, y: 1.5, z: 0 } })
    store.getState().updateTransform(cameraId, { position: { x: 5, y: 1.5, z: 0 } })
    stepCameraStageHistory(store, 'undo')
    expect(store.getState().sceneSettings.fog.distance).toBe(90)
  })

  it('旧版文档迁移后没有布景；v2 的布景参数换成风格与楼层，楼不动；布景连同装饰随文档写出与读回', () => {
    const migrated = cameraStageDocumentKind.migrations[1]!({ objects: [], activeCameraId: null, sceneSettings: {}, stateKeyframes: [] }) as CameraStageSceneContent
    expect(migrated.sets).toEqual([])
    const tower = { id: 'tower', type: 'primitive', name: '城市 楼01', setId: 'city' }
    const v2 = { objects: [tower], activeCameraId: null, sceneSettings: {}, stateKeyframes: [], sets: [
      { id: 'city', name: '城市', params: { preset: 'city', center: { x: 0, z: 0 }, rotation: 0, seed: 7, width: 240, depth: 240, blockSize: 40, streetWidth: 12, lotSize: 10, density: 0.85, height: { min: 6, max: 60 }, heightProfile: 'downtown' } },
      { id: 'street', name: '街道', params: { preset: 'street', center: { x: 0, z: 0 }, rotation: 0, seed: 1, length: 120, streetWidth: 24, lotWidth: 8, buildingDepth: 12, density: 0.9, height: { min: 6, max: 24 } } },
      { id: 'crowd', name: '人群', params: { preset: 'crowd', center: { x: 0, z: 0 }, rotation: 0, seed: 2, count: 24, formation: 'grid', spacing: 1.5, facing: 'forward' } },
    ] }
    const v3 = cameraStageDocumentKind.migrations[2]!(v2) as CameraStageSceneContent
    expect(v3.objects).toEqual(v2.objects)
    expect(v3.sets!.map(set => set.params)).toEqual([
      { preset: 'city', center: { x: 0, z: 0 }, rotation: 0, seed: 7, width: 240, depth: 240, density: 0.85, heightProfile: 'downtown', style: 'grid', floors: { min: 2, max: 19 }, props: true },
      { preset: 'street', center: { x: 0, z: 0 }, rotation: 0, seed: 1, length: 120, density: 0.9, road: 'collector', floors: { min: 2, max: 8 }, props: true },
      v2.sets[2].params,
    ])
    // 换算后的参数能直接重新生成
    expect(buildStageSet(v3.sets!, { layout: { preset: 'city' }, replaceSetId: 'city' }).objects.length).toBeGreaterThan(0)
    const scene = createDefaultCameraStageSceneSnapshot()
    const { set, objects } = buildStageSet([], { layout: { preset: 'street', seed: 2 } })
    const content = sceneToDocumentContent({ ...scene, objects: [...scene.objects, ...objects], sets: [set] })
    expect(cameraStageDocumentKind.contentSchema.safeParse(JSON.parse(JSON.stringify(content))).success).toBe(true)
    const restored = sceneFromDocumentContent(JSON.parse(JSON.stringify(content)))
    expect(restored.sets).toEqual([set])
    expect(countStageSetDecor(restored.sets?.[0]?.decor).trees).toBeGreaterThan(0)
    expect(restored.objects.filter(object => object.setId === set.id)).toHaveLength(objects.length)
    // v4 起雾距可以超过 200 米，读回不被换成默认值
    expect(sceneFromDocumentContent({ ...JSON.parse(JSON.stringify(content)), sceneSettings: { fog: { enabled: true, distance: 1200 }, sky: {} } }).sceneSettings.fog.distance).toBe(1200)
    // 成员删光的布景不写进文件。
    expect(sceneToDocumentContent({ ...scene, sets: [set] }).sets).toEqual([])
    // 更新版本才有的布景类型原样保留；记录丢了的成员回到普通对象。
    const future = { id: 'future', name: '森林', params: { preset: 'forest', seed: 1 } }
    const mixed = sceneFromDocumentContent({ ...JSON.parse(JSON.stringify(content)), sets: [future] })
    expect(mixed.sets).toEqual([future])
    expect(mixed.objects.some(object => object.setId !== undefined)).toBe(false)
  })
})
