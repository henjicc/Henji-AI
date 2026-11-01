import type { FontCatalog, FontFaceInfo, FontFileSource, FixedFontCatalog } from '../../core/fonts/catalog'
export interface FontsPlatform {
  list(fixed?: boolean): Promise<FontCatalog & Partial<Pick<FixedFontCatalog, 'sources'>>>
  /** Native picker only; callers cannot supply a filesystem path. */
  importFiles(): Promise<FontCatalog>
  remove(id: string): Promise<FontCatalog>
  readFace(id: string, source?: FontFileSource): Promise<{ face: FontFaceInfo; bytes: Uint8Array }>
  onChanged(handler: () => void): () => void
}
export const FONTS_IPC = { list: 'fonts:list', importFiles: 'fonts:import', remove: 'fonts:remove', readFace: 'fonts:read', changed: 'fonts:changed' } as const
