export type DragDropFileHandler = (files: File[]) => void
export type DragStateHandler = (isDragging: boolean) => void

export interface DragDropPlatform {
  /** 拖出：把本地文件拖到桌面/外部应用；Electron 走 webContents.startDrag（仅支持已存在的本地文件）。 */
  startNativeFileDrag(filePath: string, iconPath?: string): Promise<void>
  /** 拖入：监听文件拖入窗口，返回取消监听函数。 */
  onFilesDropped(handler: DragDropFileHandler): () => void
  /** 拖入过程中的进入/离开状态，用于 UI 高亮。 */
  onDragStateChange(handler: DragStateHandler): () => void
}
