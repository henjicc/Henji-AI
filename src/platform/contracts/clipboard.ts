export interface ClipboardFileEntry {
  path: string
  data: string
  mimeType: string
}

export interface ClipboardPlatform {
  readClipboardFiles(): Promise<ClipboardFileEntry[]>
  readText(): Promise<string>
  writeImageFromPath(filePath: string): Promise<void>
  writeImageFromSource(source: string): Promise<void>
}
