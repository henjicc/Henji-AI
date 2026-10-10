import { prepareFontPayloads, validateFontName, type FontPayload } from '@/platform/fonts'
import { LoadedFontFaces, loadDocumentFont } from '@/platform/fontFaces'
import { richTextFontNames } from '@/core/imaging/vectorContent'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditLayerV3 } from '@/core/imageEdit/v3/layerTypes'

let workerFonts: LoadedFontFaces | undefined
export function vectorDocumentFontNames(document: ImageEditDocumentV3): string[] {
  const names = new Set<string>()
  const visit = (layers: readonly ImageEditLayerV3[]): void => {
    for (const layer of layers) {
      if (!layer.visible) continue
      if (layer.type === 'text') for (const name of richTextFontNames(layer.content)) names.add(name)
      else if (layer.type === 'group') visit(layer.children)
      else if (layer.type === 'smart') visit(layer.content.document.layers)
    }
  }
  visit(document.layers)
  return [...names]
}
export async function prepareVectorDocumentFonts(document: ImageEditDocumentV3): Promise<FontPayload[]> {
  const names = vectorDocumentFontNames(document)
  if (!names.length) return []
  const payloads = await prepareFontPayloads(names)
  for (const name of names) validateFontName(name)
  return payloads
}
/** Worker receives verified font bytes from its host; it never calls PAL. */
export async function loadVectorFonts(payloads: readonly FontPayload[]): Promise<void> {
  const fonts = (globalThis as typeof globalThis & { fonts?: FontFaceSet }).fonts
  if (fonts && typeof FontFace !== 'undefined') {
    workerFonts ??= new LoadedFontFaces(fonts, 64 * 1024 * 1024)
    workerFonts.setPinnedIds(payloads.map(payload => payload.face.id))
    await Promise.all(payloads.map(payload => workerFonts!.load(payload)))
  } else await Promise.all(payloads.map(loadDocumentFont))
}
export async function ensureVectorDocumentFonts(document: ImageEditDocumentV3): Promise<void> {
  await loadVectorFonts(await prepareVectorDocumentFonts(document))
}
