/**
 * 本地媒体路径 -> 可在 <img>/<video>/<audio> 中直接使用的 URL。
 * Electron 用 protocol.handle 自定义协议提供本地媒体展示 URL。
 */
export interface MediaPlatform {
  enqueueRecycle(paths: string[], protectedBy?: string[]): Promise<void>
  toDisplaySrc(localPath: string): string
  readLocalFileAsBlob(localPath: string, mimeHint?: string): Promise<Blob>
  readLocalFileAsDataUrl(localPath: string, mimeHint?: string): Promise<string>
  /** 拿渲染层 File 对象对应的本地文件系统路径；不是真实磁盘文件时返回空字符串 */
  getPathForFile(file: File): string
  /** 解析随应用分发的内置只读资源（resources/ 下相对路径）的绝对路径；不存在时返回 null */
  getBundledResourcePath(relativePath: string): Promise<string | null>
  importFromPath(request: ImportMediaFromPathRequest): Promise<LocalMediaImportResult>
  importFromBytes(request: ImportMediaFromBytesRequest): Promise<LocalMediaImportResult>
  captureApplicationSurface(request: SurfaceCaptureRequest): Promise<SurfaceCaptureResult>
  /**
   * 截取当前窗口页面里一块矩形（CSS 像素）此刻显示的画面。返回实际截到的范围 rect（CSS 像素，已按界面缩放向内收到整像素）
   * 与设备像素尺寸的高质量 JPEG 数据。
   */
  captureWindowRegion(rect: { x: number; y: number; width: number; height: number }): Promise<{ rect: { x: number; y: number; width: number; height: number }; jpeg: Uint8Array }>
}
import type { SurfaceCaptureRequest, SurfaceCaptureResult } from '@/core/application-control/surfaceObservation'
import type {
  ImportMediaFromBytesRequest,
  ImportMediaFromPathRequest,
  LocalMediaImportResult,
} from '@/core/media/localMediaImportContracts'
