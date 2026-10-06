import type { UiScaleFactor, WindowContentSize } from '@/core/theme/uiScale'

export interface WindowAppearance {
  windowBackground: string
  colorScheme: 'dark' | 'light'
}

/**
 * 剪辑独立面板窗口（无系统边框、无 preload）由主窗口代为移动：标题栏拖动时主窗口把指针的屏幕坐标交给主进程，
 * 主进程按抓取点移动窗口（不受渲染层 moveTo 必须完整留在当前屏幕内的限制，可拖过显示器、可部分移出屏幕）。
 * `panelKey` 只能指向调用窗口自己打开的浮窗。
 */
export type WindowPopoutControlRequest =
  | { panelKey: string; action: 'begin-move' | 'move'; x: number; y: number }
  | { panelKey: string; action: 'end-move' | 'collapse' | 'expand' | 'toggle-maximize' }

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
  /** 移动/收起/最大化本窗口打开的剪辑独立面板窗口（见 WindowPopoutControlRequest）。 */
  controlPopout(request: WindowPopoutControlRequest): Promise<void>
}
