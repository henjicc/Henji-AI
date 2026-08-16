import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listProjects: vi.fn(),
  readSnapshot: vi.fn(),
  readPlayback: vi.fn(() => ({ playing: false, currentTime: 0, loop: false })),
}))

vi.mock('./cameraStageApplicationService', () => ({
  cameraStageApplicationService: {
    listProjects: mocks.listProjects,
    readSnapshot: mocks.readSnapshot,
    readPlayback: mocks.readPlayback,
  },
}))

import { createDefaultAnimation } from '../domain/animationTypes'
import { listAnimatablePropertyPaths } from '../domain/animatableProps'
import { createCameraObject, createDefaultSceneSettings, createPrimitiveObject, pickDefaultColor } from '../domain/sceneDefaults'
import { ApplicationReflectionRegistry } from '@/core/application-control'
import { CAMERA_STAGE_ENTITY_TYPES, createCameraStageReflectionRegistrations } from './cameraStageReflection'

describe('三维应用反射注册', () => {
  beforeEach(() => {
    const camera = createCameraObject('主摄像机', pickDefaultColor(0))
    mocks.listProjects.mockResolvedValue([{
      id: 'project-1', name: '反射测试', createdAt: 1, updatedAt: 2, objectCount: 1,
    }])
    mocks.readSnapshot.mockResolvedValue({
      id: 'project-1',
      name: '反射测试',
      createdAt: 1,
      updatedAt: 2,
      objects: [camera],
      activeCameraId: camera.id,
      animation: createDefaultAnimation(),
      sceneSettings: createDefaultSceneSettings(),
      stateKeyframes: [],
    })
  })

  it('只注册状态关键帧架构的公开实体', () => {
    const registrations = createCameraStageReflectionRegistrations(() => 7)

    expect(registrations.map((item) => item.entity.id)).toEqual(Object.values(CAMERA_STAGE_ENTITY_TYPES))
    expect(registrations.every((item) => item.provider)).toBe(true)
    expect(registrations.every((item) => item.entity.revisionScopes.includes('toolbox'))).toBe(true)
  })

  it('从唯一动画属性注册表生成对象和摄像机可动画属性描述', () => {
    const registrations = createCameraStageReflectionRegistrations(() => 7)
    const objectProperties = registrations.find((item) => item.entity.id === CAMERA_STAGE_ENTITY_TYPES.object)!.properties
    const cameraProperties = registrations.find((item) => item.entity.id === CAMERA_STAGE_ENTITY_TYPES.camera)!.properties

    for (const path of listAnimatablePropertyPaths()) {
      const safePath = path.replace(/[A-Z]/g, (character) => `_${character.toLocaleLowerCase()}`)
      const registered = objectProperties.some((property) => property.id === `camera_stage.object.animatable.${safePath}`)
        || cameraProperties.some((property) => property.id === `camera_stage.camera.animatable.${safePath}`)
      expect(registered).toBe(true)
    }
  })

  it('全部正式实体和属性都能通过应用反射注册表严格校验', () => {
    const registry = new ApplicationReflectionRegistry('application-capabilities/v2')

    for (const registration of createCameraStageReflectionRegistrations(() => 7)) {
      registry.register(registration)
    }

    expect(registry.describe({}, {
      exposure: 'assistant',
      permissions: new Set(['camera_stage:read', 'camera_stage:write']),
      acceptedDataClasses: new Set(['C1']),
      // 7 类：project / scene / object / camera / stateKeyframe / trajectory / playback
    }).entities).toHaveLength(7)
  })

  it('提供稳定引用、属性快照和工具箱 revision', async () => {
    const registration = createCameraStageReflectionRegistrations(() => 7)
      .find((item) => item.entity.id === CAMERA_STAGE_ENTITY_TYPES.project)!
    const listed = await registration.provider!.listEntities({ limit: 20 })
    const snapshot = await registration.provider!.readEntity(listed.refs[0], {})

    expect(listed.refs[0]).toMatchObject({ kind: 'camera_stage.project', id: 'project-1' })
    expect(listed.revisions).toEqual({ toolbox: 7 })
    expect(snapshot.properties['camera_stage.project.name']).toBe('反射测试')
    expect(snapshot.revisions).toEqual({ toolbox: 7 })
  })

  it('当前工程内唯一的子实体短 ID 会规范化为完整稳定引用', async () => {
    const camera = createCameraObject('主摄像机', pickDefaultColor(0))
    const object = createPrimitiveObject('sphere', '球', pickDefaultColor(1))
    mocks.readSnapshot.mockResolvedValue({
      id: 'project-1', name: '反射测试', createdAt: 1, updatedAt: 2,
      objects: [camera, object], activeCameraId: camera.id,
      animation: createDefaultAnimation(), sceneSettings: createDefaultSceneSettings(), stateKeyframes: [],
    })
    const registration = createCameraStageReflectionRegistrations(() => 7)
      .find((item) => item.entity.id === CAMERA_STAGE_ENTITY_TYPES.object)!

    const snapshot = await registration.provider!.readEntity({
      kind: CAMERA_STAGE_ENTITY_TYPES.object,
      id: object.id,
    }, {})

    expect(snapshot.ref).toMatchObject({
      kind: CAMERA_STAGE_ENTITY_TYPES.object,
      id: `project-1:${object.id}`,
    })
  })

  it('单条不可读记录不会污染其余现役工程的实体枚举', async () => {
    mocks.listProjects.mockResolvedValue([
      { id: 'old-project', name: '旧记录', createdAt: 0, updatedAt: 0, objectCount: 0 },
      { id: 'project-1', name: '反射测试', createdAt: 1, updatedAt: 2, objectCount: 1 },
    ])
    const validSnapshot = await mocks.readSnapshot()
    mocks.readSnapshot.mockImplementation(async (projectId: string) => {
      if (projectId === 'old-project') throw new Error('UNSUPPORTED_CAMERA_STAGE_SCHEMA:12')
      return validSnapshot
    })
    const registration = createCameraStageReflectionRegistrations(() => 7)
      .find((item) => item.entity.id === CAMERA_STAGE_ENTITY_TYPES.project)!

    await expect(registration.provider!.listEntities({ limit: 20 })).resolves.toMatchObject({
      refs: [{ kind: CAMERA_STAGE_ENTITY_TYPES.project, id: 'project-1' }],
    })
  })

  it('状态关键帧集合始终可增删，公开目录不存在属性轨道关键帧', async () => {
    const registry = new ApplicationReflectionRegistry('application-capabilities/v2')
    for (const registration of createCameraStageReflectionRegistrations(() => 7)) registry.register(registration)
    const context = {
      exposure: 'assistant' as const,
      permissions: new Set(['camera_stage:read', 'camera_stage:write']),
      acceptedDataClasses: new Set(['C1'] as const),
    }
    const parent = { kind: CAMERA_STAGE_ENTITY_TYPES.scene, id: 'project-1' }

    const availability = await registry.getCollectionAvailability(parent, CAMERA_STAGE_ENTITY_TYPES.stateKeyframe, context)
    expect(availability.create.available).toBe(true)
    expect(availability.remove.available).toBe(true)
    expect(registry.describe({}, context).entities.map((entity) => entity.id)).not.toContain('camera_stage.keyframe')
  })

  it('空时间轴只禁用播放开关，不影响定位和循环属性', async () => {
    const registry = new ApplicationReflectionRegistry('application-capabilities/v2')
    for (const registration of createCameraStageReflectionRegistrations(() => 7)) registry.register(registration)
    const availability = await registry.getPropertyAvailability(
      { kind: CAMERA_STAGE_ENTITY_TYPES.playback, id: 'project-1' },
      [
        'camera_stage.playback.playing',
        'camera_stage.playback.current_time',
        'camera_stage.playback.loop',
      ],
      {
        exposure: 'assistant',
        permissions: new Set(['camera_stage:read', 'camera_stage:write']),
        acceptedDataClasses: new Set(['C1']),
      },
    )
    expect(availability.map((item) => [item.propertyId, item.writable])).toEqual([
      ['camera_stage.playback.playing', false],
      ['camera_stage.playback.current_time', true],
      ['camera_stage.playback.loop', true],
    ])
  })
})
