/**
 * 本地媒体路径 -> 可在 <img>/<video>/<audio> 中直接使用的 URL。
 * Electron 用 protocol.handle 自定义协议提供本地媒体展示 URL。
 */
export interface MediaPlatform {
  allowRoot(rootPath: string): Promise<void>
  /** 判断某个绝对路径是否在媒体协议允许读取的根目录范围内 */
  isPathAllowed(targetPath: string): Promise<boolean>
  toDisplaySrc(localPath: string): string
  readLocalFileAsBlob(localPath: string, mimeHint?: string): Promise<Blob>
  readLocalFileAsDataUrl(localPath: string, mimeHint?: string): Promise<string>
  /** 拿渲染层 File 对象对应的本地文件系统路径；不是真实磁盘文件时返回空字符串 */
  getPathForFile(file: File): string
}
