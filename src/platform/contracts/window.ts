import type { UiScaleFactor, WindowContentSize } from '@/core/theme/uiScale'

export interface WindowAppearance {
  windowBackground: string
  colorScheme: 'dark' | 'light'
}

export interface WindowPlatform {
  minimize(): Promise<void>
  toggleMaximize(): Promise<void>
  close(): Promise<void>
  isMaximized(): Promise<boolean>
  getContentSize(): Promise<WindowContentSize>
  setZoomFactor(factor: UiScaleFactor): Promise<void>
  /** 把主题的窗口底色与 color-scheme 同步给主进程（新建窗口首帧、缩放露底时使用）。 */
  setAppearance(appearance: WindowAppearance): Promise<void>
  /** 窗口尺寸/最大化状态变化时触发，返回取消监听函数。 */
  onResized(handler: () => void): () => void
  /** 开发期：打开/关闭 DevTools（Electron 用 webContents.openDevTools 平替 toggle_devtools）。 */
  toggleDevTools(): Promise<void>
  /** 主进程准备关闭窗口时触发；渲染层完成关键写入后必须调用 confirmClose。 */
  onCloseRequested(handler: () => void): () => void
  confirmClose(): Promise<void>
}
