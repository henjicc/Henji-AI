import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listProjects: vi.fn(),
  readSnapshot: vi.fn(),
}))

vi.mock('./cameraStageApplicationService', () => ({
  cameraStageApplicationService: {
    listProjects: mocks.listProjects,
    readSnapshot: mocks.readSnapshot,
  },
}))

import { createDefaultAnimation } from '../domain/animationTypes'
import { listAnimatablePropertyPaths } from '../domain/animatableProps'
import { createCameraObject, createDefaultSceneSettings, pickDefaultColor } from '../domain/sceneDefaults'
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
      editorMode: 'pro',
      shots: [],
    })
  })

  it('注册工程、场景、对象、摄像机、镜头、轨迹和关键帧七类正式实体', () => {
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
})
