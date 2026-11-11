import type { FontCatalog, FontFaceInfo, FontFileSource, FixedFontCatalog } from '../../core/fonts/catalog'
export interface FontsPlatform {
  list(fixed?: boolean): Promise<FontCatalog & Partial<Pick<FixedFontCatalog, 'sources'>>>
  /** 不传路径时弹出系统选择框；拖进来的字体文件直接给路径。 */
  importFiles(paths?: readonly string[]): Promise<FontCatalog>
  remove(id: string): Promise<FontCatalog>
  readFace(id: string, source?: FontFileSource): Promise<{ face: FontFaceInfo; bytes: Uint8Array }>
  onChanged(handler: () => void): () => void
}
export const FONTS_IPC = { list: 'fonts:list', importFiles: 'fonts:import', remove: 'fonts:remove', readFace: 'fonts:read', changed: 'fonts:changed' } as const
