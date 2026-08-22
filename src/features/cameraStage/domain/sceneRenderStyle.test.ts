import { describe, expect, it } from 'vitest'
import { normalizeStageRenderStyle } from './renderStyles'
import { createCameraObject, createDefaultSceneSettings, pickDefaultColor } from './sceneDefaults'
import { deserializeScene, serializeScene } from './sceneSerialization'

function sceneJson(style: unknown, options: { omitRender?: boolean } = {}): string {
  const camera = createCameraObject('主摄像机', pickDefaultColor(0))
  const sceneSettings = createDefaultSceneSettings()
  const raw = JSON.parse(serializeScene({
    objects: [camera],
    activeCameraId: camera.id,
    sceneSettings,
    stateKeyframes: [],
  })) as { sceneSettings: Record<string, unknown> }
  if (options.omitRender) {
    delete raw.sceneSettings.render
  } else {
    raw.sceneSettings.render = { style }
  }
  return JSON.stringify(raw)
}

describe('渲染方式的持久化', () => {
  it('非法值与缺失值一律回退彩色', () => {
    expect(normalizeStageRenderStyle(undefined)).toBe('beauty')
    expect(normalizeStageRenderStyle('wireframe')).toBe('beauty')
    expect(normalizeStageRenderStyle('depth')).toBe('depth')
  })

  it('工程读写保留渲染方式', () => {
    expect(deserializeScene(sceneJson('lineart')).sceneSettings.render.style).toBe('lineart')
  })

  it('没有渲染方式字段的旧工程按彩色打开，不因此变成不可读工程', () => {
    const snapshot = deserializeScene(sceneJson(null, { omitRender: true }))

    expect(snapshot.sceneSettings.render.style).toBe('beauty')
    expect(snapshot.objects).toHaveLength(1)
  })
})
