export interface WindowPlatform {
  minimize(): Promise<void>
  toggleMaximize(): Promise<void>
  close(): Promise<void>
  isMaximized(): Promise<boolean>
  /** 窗口尺寸/最大化状态变化时触发，返回取消监听函数。 */
  onResized(handler: () => void): () => void
  /** 开发期：打开/关闭 DevTools（Electron 用 webContents.openDevTools 平替 toggle_devtools）。 */
  toggleDevTools(): Promise<void>
}
