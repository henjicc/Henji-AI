import { create } from 'zustand'

import type { SettingsNavigationTarget } from '@/core/types/settingsNavigation'

/**
 * 全局 UI 开关状态（不持久化）。
 *
 * 与 settingsStore 的分工：settingsStore 存的是用户配置本身（会落盘），
 * 这里存的是"面板开没开、开在哪一节"这类进程内的临时视图状态。
 *
 * 之所以要提到 store：错误弹窗的「去设置」按钮可能从任意深度的组件触发，
 * 局部 state 传不下去。
 */
interface UiState {
  isSettingsOpen: boolean
  /** 本次打开设置要定位到的位置；null 表示用设置面板自己的默认分节 */
  settingsTarget: SettingsNavigationTarget | null
  openSettings: (target?: SettingsNavigationTarget) => void
  closeSettings: () => void
}

export const useUiStore = create<UiState>((set) => ({
  isSettingsOpen: false,
  settingsTarget: null,
  openSettings: (target) => set({ isSettingsOpen: true, settingsTarget: target ?? null }),
  closeSettings: () => set({ isSettingsOpen: false, settingsTarget: null }),
}))

/** 非 React 环境（服务层、事件回调）打开设置的入口 */
export function openSettingsPanel(target?: SettingsNavigationTarget): void {
  useUiStore.getState().openSettings(target)
}
