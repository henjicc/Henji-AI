/**
 * 本地媒体路径 -> 可在 <img>/<video>/<audio> 中直接使用的 URL。
 * Electron 用 protocol.handle 自定义协议提供本地媒体展示 URL。
 */
export interface MediaPlatform {
  allowRoot(rootPath: string): Promise<void>
  toDisplaySrc(localPath: string): string
  readLocalFileAsBlob(localPath: string, mimeHint?: string): Promise<Blob>
  readLocalFileAsDataUrl(localPath: string, mimeHint?: string): Promise<string>
}
