import { create } from 'zustand'

/**
 * 开发者面板只在开发版出现，不进正式工具目录、导航与助手能力：是否打开只是工具箱自己的一份视图状态。
 * 开发启动 `--dev-surface=dev.sdk_models` 也走这里。
 */
export const useDeveloperPanel = create<{ open: boolean }>(() => ({ open: false }))

export function setDeveloperPanelOpen(open: boolean): void {
  useDeveloperPanel.setState({ open })
}
