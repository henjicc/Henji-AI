import { GENERIC_FONT_FACES, type FontFaceInfo } from '../fonts/catalog'
import type { VideoEditDocument, VideoEditComposition } from './document'
import type { CodeMaterialMetadataReader } from './codeMaterialDocument'
import type { CodeMaterialInstance } from './codeMaterialPersistence'
import type { CodeParameterDeclaration } from './codeMaterial/contract'
import { videoEditEffectCodes } from './compositing'
export interface VideoEditFontUse { font: string; ownerId: string; label: string }
export interface MissingVideoEditFont { font: string; fallback: string; uses: VideoEditFontUse[] }

/** Derived from persisted fields: projects already record the exact names; no second mutable font manifest. */
export function collectVideoEditFonts(document: VideoEditDocument | VideoEditComposition, readCode?: CodeMaterialMetadataReader): VideoEditFontUse[] {
  const uses: VideoEditFontUse[] = []
  const seen = new Set<string>()
  const add = (font: unknown, ownerId: string, label: string): void => { if (typeof font === 'string' && font.trim()) { const key = `${ownerId}\u0000${font}`; if (!seen.has(key)) { seen.add(key); uses.push({ font, ownerId, label }) } } }
  const graphic = (value: VideoEditDocument['items'][number]['graphic'], ownerId: string, label: string): void => {
    for (const object of value?.objects ?? []) if (object.kind === 'text') {
      add(object.textStyle?.fontFamily ?? 'sans-serif', `${ownerId}:graphic:${object.id}`, `${label} / ${object.name}`)
    }
  }
  const code = (instance: CodeMaterialInstance | undefined, ownerId: string, label: string): void => {
    if (!instance || !readCode) return
    const collect = (parameter: CodeParameterDeclaration, value: unknown, id: string, title: string): void => {
      if (parameter.type === 'font') add(value, id, title)
      if (parameter.type === 'textStyle' && value && typeof value === 'object' && 'fontFamily' in value) add(value.fontFamily, id, title)
      if (parameter.type === 'table' && Array.isArray(value)) value.forEach((row: unknown, index: number) => {
        if (row && typeof row === 'object') for (const [key, field] of Object.entries(parameter.fields)) collect(field, (row as Record<string, unknown>)[key], `${id}:${index}:${key}`, title)
      })
      if (parameter.type === 'custom' && value && typeof value === 'object' && !Array.isArray(value)) {
        for (const [key, field] of Object.entries(parameter.fields)) collect(field, (value as Record<string, unknown>)[key], `${id}:${key}`, title)
      }
    }
    for (const parameter of readCode(instance).parameters) {
      collect(parameter, instance.parameters[parameter.key] ?? parameter.default, `${ownerId}:font:${parameter.key}`, label)
      for (const point of instance.curves?.[parameter.key] ?? []) collect(parameter, point.value, `${ownerId}:font:${parameter.key}:key:${point.id}`, `${label}（关键帧）`)
    }
  }
  const sequences = 'clips' in document ? [document, ...(document.sequences ?? [])] : document.sequences
  for (const sequence of sequences) {
    for (const clip of sequence.clips) {
      const owner = `${sequence.id}:clip:${clip.id}`
      if (clip.kind === 'text') add(clip.textStyle?.fontFamily ?? 'sans-serif', owner, clip.name)
      graphic(clip.graphic, owner, clip.name); code(clip.code, owner, clip.name)
      for (const [index, effect] of videoEditEffectCodes(clip.effects).entries()) code(effect, `${owner}:effect:${index}`, `${clip.name} / 代码效果`)
    }
    for (const caption of sequence.captions ?? []) add(caption.style ? caption.style.fontFamily : 'sans-serif', `${sequence.id}:caption:${caption.id}`, `字幕：${caption.text}`)
  }
  for (const item of document.items) {
    const owner = `item:${item.id}`
    if (item.kind === 'text') add('sans-serif', owner, item.name)
    graphic(item.graphic, owner, item.name); code(item.code, owner, item.name)
  }
  return uses
}
export function missingVideoEditFonts(uses: VideoEditFontUse[], faces: readonly FontFaceInfo[]): MissingVideoEditFont[] {
  const result = new Map<string, MissingVideoEditFont>()
  const names = new Set([...GENERIC_FONT_FACES, ...faces].flatMap(face => [face.family, face.localizedFamily, face.fullName, face.postscriptName, ...face.aliases]).map(name => name.trim().toLocaleLowerCase()))
  // Built-in style presets only recommend fonts and fall back automatically; the user never chose them, so they are not "missing".
  for (const use of uses) if (!use.ownerId.startsWith('style:builtin:') && !names.has(use.font.trim().toLocaleLowerCase())) {
    const previous = result.get(use.font) ?? { font: use.font, fallback: '系统无衬线字体', uses: [] }
    previous.uses.push(use); result.set(use.font, previous)
  }
  return [...result.values()]
}
