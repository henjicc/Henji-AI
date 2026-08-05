import { describe, expect, it } from 'vitest'

import { createDefaultSceneSettings } from '../domain/sceneDefaults'
import { useCameraStageStore } from '../store/cameraStageStore'
import { sceneAppearanceProperties } from './cameraStageReflection'

/*
 * 助手能做的事必须覆盖界面能做的事。
 *
 * 场景外观（天空、地面、雾、阳光、名称标签）在界面上有 24 项开关，此前助手一项都动不了——
 * 不是被权限挡住，是这些字段**根本没注册成实体属性**，通用动词看不见它们。于是"把天空改成
 * 深蓝""地面换成网格""把太阳调到黄昏"全部做不到。
 *
 * 这条测试盯住的是"漏注册"这类静默失效：界面加了新的场景设置却忘了注册，助手会安静地少一项
 * 能力，没有任何报错。所以断言方向是**从 store 动作反推**，而不是从注册表自证。
 */

/** store 里 setSceneXxx 动作名 → 反射属性后缀。命名规则是驼峰转下划线，去掉 setScene 前缀。 */
function propertySuffixFromAction(action: string): string {
  return action
    .replace(/^setScene/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
}

describe('场景外观的助手覆盖度', () => {
  it('界面能改的每一项场景设置，助手都读得到', () => {
    const registered = new Set(
      Object.keys(sceneAppearanceProperties(createDefaultSceneSettings()))
        .map((id) => id.replace('camera_stage.scene.', ''))
    )
    const actions = Object.keys(useCameraStageStore.getState())
      .filter((key) => key.startsWith('setScene'))
    expect(actions.length).toBeGreaterThanOrEqual(24)

    const missing = actions
      .map(propertySuffixFromAction)
      .filter((suffix) => !registered.has(suffix))
    expect(missing, `界面能改但助手读不到的场景设置：${missing.join('、')}`).toEqual([])
  })

  it('读出来的值就是场景设置里的真实值', () => {
    const settings = createDefaultSceneSettings()
    const properties = sceneAppearanceProperties(settings)
    expect(properties['camera_stage.scene.sky_color']).toBe(settings.sky.color)
    expect(properties['camera_stage.scene.ground_pattern']).toBe(settings.ground.pattern)
    expect(properties['camera_stage.scene.sunlight_time_of_day']).toBe(settings.sunlight.timeOfDay)
    expect(properties['camera_stage.scene.fog_enabled']).toBe(settings.fog.enabled)
    expect(properties['camera_stage.scene.name_label_offset'])
      .toEqual({ ...settings.display.nameLabel.offset })
  })
})
