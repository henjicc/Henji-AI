export interface ClipboardFileEntry {
  path: string
  data: string
  mimeType: string
}

export interface ClipboardImage {
  /** 统一为 data URL，来源是位图还是图片文件由 origin 区分 */
  dataUrl: string
  name: string
  origin: 'bitmap' | 'file'
}

export interface ClipboardPlatform {
  readClipboardFiles(): Promise<ClipboardFileEntry[]>
  readText(): Promise<string>
  /** 剪贴板里没有图片时返回 null */
  readImage(): Promise<ClipboardImage | null>
  writeImageFromPath(filePath: string): Promise<void>
  writeImageFromSource(source: string): Promise<void>
}
