/**
 * 本地媒体路径 -> 可在 <img>/<video>/<audio> 中直接使用的 URL。
 * Tauri 现状主导方案是 convertFileSrc（见 1.1 盘点），Electron 用
 * protocol.handle 自定义协议替代（决定见 01-迁移方案 第四节）。
 */
export interface MediaPlatform {
  toDisplaySrc(localPath: string): string
  readLocalFileAsBlob(localPath: string, mimeHint?: string): Promise<Blob>
  readLocalFileAsDataUrl(localPath: string, mimeHint?: string): Promise<string>
}
