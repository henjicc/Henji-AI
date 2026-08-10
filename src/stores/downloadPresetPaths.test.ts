import { beforeEach, describe, expect, it } from 'vitest'

import { DOWNLOAD_PRESET_PATH_LIMIT, useSettingsStore } from './settingsStore'

/*
 * 回归：下载预设路径**只有读取方，没有写入入口**。
 *
 * 画布节点的下载菜单按 downloadPresetPaths 渲染「保存到…」列表，为空时提示
 * 「暂无预设路径，请在设置 - 通用中添加」——而设置里当时根本没有这一项，
 * 软件在指示用户做一件做不到的事。字段永远是空数组，整条下载预设功能形同虚设。
 *
 * 这几条钉住写入路径确实存在且可用；上限与去重的判断在 DownloadSection 里，
 * 这里钉住的是它们依赖的常量与 store 契约。
 */

describe('下载预设路径', () => {
  beforeEach(() => {
    useSettingsStore.getState().setDownloadPresetPaths([])
  })

  it('写入方存在且真的落到 store 上', () => {
    useSettingsStore.getState().setDownloadPresetPaths(['D:/输出', 'D:/归档'])
    expect(useSettingsStore.getState().downloadPresetPaths).toEqual(['D:/输出', 'D:/归档'])
  })

  it('可以逐条移除', () => {
    useSettingsStore.getState().setDownloadPresetPaths(['D:/输出', 'D:/归档'])
    const remaining = useSettingsStore.getState().downloadPresetPaths.filter((path) => path !== 'D:/输出')
    useSettingsStore.getState().setDownloadPresetPaths(remaining)
    expect(useSettingsStore.getState().downloadPresetPaths).toEqual(['D:/归档'])
  })

  it('条数上限是一个导出常量，界面与其他消费方共用同一个值', () => {
    // 界面按它禁用「添加目录」按钮。写死在组件里会让这条限制无法被别处引用与测试。
    expect(DOWNLOAD_PRESET_PATH_LIMIT).toBe(8)
  })
})
