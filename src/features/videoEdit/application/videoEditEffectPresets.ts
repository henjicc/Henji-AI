import type { VideoEditDocument } from '@/core/videoEdit/document'
import { storedVideoEditEffectLibrarySchema, storedVideoEditEffectLibrary } from '@/core/videoEdit/effectLibrary'
import { desktopEffectLibrarySources, readEffectLibrarySources, writeEffectLibrarySources, type EffectLibrarySourceStorage } from './videoEditEffectLibrarySources'
import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { localLibraryContract, readLocalPersistenceJson, serializeVersionedPersistenceJson } from '@/core/persistence/versionedJson'
import { publishVideoEdit } from './videoEditService'
import { listVideoEditInstances } from './videoEditService'
import { renderFingerprintHash } from '@/core/videoEdit/renderFingerprint'
import { migrateVideoEditMergedEffects } from '@/core/videoEdit/mergedEffectsMigration'
import { createLogger } from '@/core/logging'
import { videoEditEffectSchema, type VideoEditEffect } from '@/core/videoEdit/compositing'
import { resolveVideoEditEffectTemplate } from '@/core/videoEdit/smartRegionPresets'
import { isRemovedVideoEditBuiltinEffect, normalizeVideoEditBuiltinParams, requireVideoEditBuiltinEffect, videoEditBuiltinEffectMedia, videoEditBuiltinRefId, videoEditEffectNeedsSubject } from '@/core/videoEdit/builtinEffects'
import { isSmartRegionMask } from '@/core/videoEdit/effectMasks'
import { VIDEO_EDIT_EFFECT_CATEGORIES, videoEditEffectsRegistry, type VideoEditEffectsRegistryEntry } from '@/core/videoEdit/effectsRegistry'

import { assertVideoEditStylePieceNames, resolveVideoEditStylePieceEffects, videoEditEffectLibrarySchema as dataSchema } from '@/core/videoEdit/effectPresets'
import { videoEditEffectPresetNameSchema as nameSchema, videoEditEffectPresetSchema, type VideoEditEffectPreset } from '@/core/videoEdit/effectPresets'
import { recycleVideoEditStylePieces, registerVideoEditStylePieceRestore } from './videoEditEffectLibraryRecycle'
import { mergeRecycledMembers } from '@/core/localRecords/recycle'
import { jsonEqual } from '@/core/jsonEqual'
import { nextVideoEditHistoryOrder, registerVideoEditLibraryHistory } from './videoEditLibraryHistory'
const logger = createLogger('features.videoEdit.presets')
export { type VideoEditEffectPreset } from '@/core/videoEdit/effectPresets'
export interface LibraryData { favorites: string[]; presets: VideoEditEffectPreset[] }
interface LibraryState extends LibraryData {
  restoreLibrary(value: LibraryData, expected?: LibraryData): void
  revision: number
  loadError: string
  ready(): Promise<void>
  /** recordHistory=false 只用于回收区恢复：恢复不进撤销，否则撤销会移除已不在回收区的风格件。 */
  saveLibrary(value: LibraryData, expected?: LibraryData, recordHistory?: boolean): Promise<string>
  undoLibrary(token?: string, redo?: boolean): void
  historyOrder(redo?: boolean): number | undefined
  forgetLibraryChange(token?: string): void
  clearLibraryRedo(): void
  renamePreset(id: string, name: string): void
  deletePreset(id: string): Promise<void>
  /** Imported presets always get fresh ids so a re-import never overwrites. */
  importPresets(presets: readonly VideoEditEffectPreset[]): Promise<VideoEditEffectPreset[]>
  toggleFavorite(id: string): void
  setFavorites(ids: string[]): void
}
export const VIDEO_EDIT_EFFECT_LIBRARY_STORAGE_KEY = 'video-edit-effects-library'
const contract = localLibraryContract(VIDEO_EDIT_EFFECT_LIBRARY_STORAGE_KEY, storedVideoEditEffectLibrarySchema)
interface SyncSettingsStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }

/** 存进风格件的效果副本：跟踪绑定只属于原片段，手绘遮罩只在用户选择时保留几何。 */
export function videoEditStylePieceEffectCopies(effects: readonly VideoEditEffect[], includeShapes = false): VideoEditEffect[] {
  return effects.map(effect => {
    const copy = videoEditEffectSchema.parse(structuredClone(effect))
    if (copy.mask?.regionId === 'tracker' || copy.mask?.regionId === 'shapes' && !includeShapes) delete copy.mask
    else if (copy.mask?.regionId === 'shapes') copy.mask.shapes.forEach(shape => { delete shape.follow })
    return copy
  })
}

/** Shared by UI and assistant discovery. The persistence write precedes publication;
 * a full disk/storage failure leaves the previous library intact. */
export function createVideoEditEffectLibraryStore(storage?: SyncSettingsStorage, sources: EffectLibrarySourceStorage = desktopEffectLibrarySources): UseBoundStore<StoreApi<LibraryState>> {
  const disk = storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage)
  let initial: LibraryData = { favorites: [], presets: [] }
  let loadError = ''
  let pending: Promise<void> | undefined
  let stored: ReturnType<typeof storedVideoEditEffectLibrarySchema.parse> | undefined
  const persisted = new Set<string>()
  type Change = { token: string; order: number; before: LibraryData; after: LibraryData }
  const past: Change[] = [], future: Change[] = []
  try {
    const saved = disk?.getItem(VIDEO_EDIT_EFFECT_LIBRARY_STORAGE_KEY)
    if (saved && disk) {
      const raw = JSON.parse(saved) as { state?: unknown }
      stored = storedVideoEditEffectLibrarySchema.parse(migrateVideoEditMergedEffects(readLocalPersistenceJson(saved, VIDEO_EDIT_EFFECT_LIBRARY_STORAGE_KEY, contract, disk, 'state' in raw ? 'state' : 'content')))
      if (!stored.presets.some(preset => preset.codeSnapshots)) initial = dataSchema.parse(stored)
      if (new Set(initial.presets.map(preset => preset.id)).size !== initial.presets.length) throw new Error('预设标识重复。')
      initial.favorites = [...new Set(initial.favorites)]
    }
  } catch (error) { loadError = '效果收藏与预设读取失败，已保留原数据；请重启应用后重试。'; initial = { favorites: [], presets: [] }; logger.error('effect_library.load.failed', '效果收藏与预设读取失败', { error }) }
  const store = create<LibraryState>((set, get) => {
    const publish = (operation: string, next: LibraryData, expected?: LibraryData, recordHistory = true): string => {
      logger.info(`effect_library.${operation}.start`, '更新本机效果库')
      try {
        if (!disk) throw new Error('本机预设存储不可用。')
        if (loadError) throw new Error(loadError)
        if (pending) throw new Error('效果库仍在读取，请稍后重试。')
        const known = new Set([...get().favorites, ...videoEditEffectsRegistry().map(entry => entry.id), ...next.presets.map(preset => `preset:${preset.id}`)])
        if (recordHistory && next.favorites.some(id => !known.has(id))) throw new Error('这个效果或过渡已不可用。')
        for (const preset of next.presets) for (const snapshot of Object.values(preset.codeSnapshots ?? {})) for (const source of snapshot.codeSources) if (!persisted.has(source.hash)) throw new Error('代码快照尚未保存，请通过正式保存操作写入效果库。')
        // 撤销只能恢复仍与已完成事务吻合的历史快照，包括旧库已有的重名。
        if (expected) {
          if (!jsonEqual({ favorites: get().favorites, presets: get().presets }, expected)) throw new Error('风格件库已有后续修改，请重新读取。')
        } else assertVideoEditStylePieceNames(next.presets, get().presets)
        disk.setItem(VIDEO_EDIT_EFFECT_LIBRARY_STORAGE_KEY, serializeVersionedPersistenceJson(contract, storedVideoEditEffectLibrary(next)))
        const token = crypto.randomUUID()
        const change = recordHistory ? { token, order: nextVideoEditHistoryOrder('library'), before: { favorites: get().favorites, presets: get().presets }, after: next } : undefined
        set({ ...next, revision: get().revision + 1 })
        if (change) { past.push(change); past.splice(0, past.length - 50); future.length = 0 }
        publishVideoEdit()
        logger.info(`effect_library.${operation}.completed`, '本机效果库已保存')
        return token
      } catch (error) { logger.error(`effect_library.${operation}.failed`, '本机效果库保存失败', { error }); throw error }
    }
    const requirePreset = (id: string): VideoEditEffectPreset => {
      const preset = get().presets.find(value => value.id === id)
      if (!preset) throw new Error('原预设已删除，请重新选择。')
      return preset
    }
    return {
      ...initial, revision: 0, loadError,
      restoreLibrary(value, expected) { publish('restore', dataSchema.parse(structuredClone(value)), expected, false) },
      historyOrder(redo = false) {
        const entry = (redo ? future : past).at(-1)
        // 库对象在发布间共享引用，比较通常在根节点就结束。
        return entry && jsonEqual({ favorites: get().favorites, presets: get().presets }, redo ? entry.before : entry.after) ? entry.order : undefined
      },
      undoLibrary(token, redo = false) {
        const source = redo ? future : past, target = redo ? past : future, entry = source.at(-1)
        if (!entry || token && entry.token !== token) throw new Error('风格件库撤销记录不存在或已有后续修改。')
        // 先移动记录再发布，订阅者在发布时读到的撤销/重做状态已是最终状态。
        source.pop(); target.push(entry)
        try { get().restoreLibrary(redo ? entry.after : entry.before, redo ? entry.before : entry.after) } catch (error) { target.pop(); source.push(entry); throw error }
      },
      forgetLibraryChange(token) {
        for (const stack of [past, future]) {
          if (!token) stack.length = 0
          else { const index = stack.findIndex(entry => entry.token === token); if (index >= 0) stack.splice(index, 1) }
        }
      },
      clearLibraryRedo() { future.length = 0 },
      ready() { return pending ?? (loadError ? Promise.reject(new Error(loadError)) : Promise.resolve()) },
      async saveLibrary(value, expected, recordHistory = true) {
        await get().ready()
        const before = { favorites: get().favorites, presets: get().presets }
        const next = dataSchema.parse(value)
        assertVideoEditStylePieceNames(next.presets, before.presets)
        const removed = before.presets.filter(preset => !next.presets.some(value => value.id === preset.id))
        logger.info('effect_library.sources.start', '保存风格件源码')
        let stored: ReturnType<typeof storedVideoEditEffectLibrary>
        try { stored = await writeEffectLibrarySources(next, sources, persisted); logger.info('effect_library.sources.completed', '风格件源码已保存') }
        catch (error) { logger.error('effect_library.sources.failed', '风格件源码保存失败', { error }); throw error }
        for (const preset of stored.presets) for (const snapshot of Object.values(preset.codeSnapshots ?? {})) for (const source of snapshot.codeSources) persisted.add(source.hash)
        if (removed.length) await recycleVideoEditStylePieces({ presets: removed, favorites: before.favorites.filter(ref => removed.some(preset => ref === `preset:${preset.id}`)) })
        return publish('save', next, expected ?? before, recordHistory)
      },
      renamePreset(id, name) { requirePreset(id); const nextName = nameSchema.parse(name); publish('rename', { favorites: get().favorites, presets: get().presets.map(preset => preset.id === id ? { ...preset, name: nextName } : preset) }) },
      async importPresets(values) { await get().ready(); const added = values.map(value => videoEditEffectPresetSchema.parse({ ...structuredClone(value), id: crypto.randomUUID() })); await get().saveLibrary({ favorites: get().favorites, presets: [...get().presets, ...added] }); return added },
      async deletePreset(id) { await get().ready(); requirePreset(id); await get().saveLibrary({ favorites: get().favorites.filter(ref => ref !== `preset:${id}`), presets: get().presets.filter(preset => preset.id !== id) }) },
      setFavorites(ids) {
        publish('favorite', { presets: get().presets, favorites: [...new Set(ids)] })
      },
      toggleFavorite(id) {
        if (!videoEditEffectsRegistry().some(entry => entry.id === id) && !get().presets.some(preset => `preset:${preset.id}` === id)) throw new Error('这个效果或过渡已不可用。')
        get().setFavorites(get().favorites.includes(id) ? get().favorites.filter(value => value !== id) : [...get().favorites, id])
      },
    }
  })
  if (stored?.presets.some(preset => preset.codeSnapshots)) {
    pending = readEffectLibrarySources(stored, sources).then(value => {
      for (const preset of value.presets) for (const snapshot of Object.values(preset.codeSnapshots ?? {})) for (const source of snapshot.codeSources) persisted.add(source.hash)
      store.setState({ ...value, revision: store.getState().revision + 1 })
      publishVideoEdit()
    }, error => { loadError = '效果库源码读取失败，已保留原数据；请恢复源码后重启应用。'; store.setState({ loadError }); logger.error('effect_library.load.failed', '效果库源码读取失败', { error }); throw error }).finally(() => { pending = undefined })
    void pending.catch(() => undefined)
  }
  return store
}
export const useVideoEditEffectLibraryStore = createVideoEditEffectLibraryStore()
registerVideoEditLibraryHistory({
  order: redo => useVideoEditEffectLibraryStore.getState().historyOrder(redo),
  apply: redo => useVideoEditEffectLibraryStore.getState().undoLibrary(undefined, redo),
  clearRedo: () => useVideoEditEffectLibraryStore.getState().clearLibraryRedo(),
})
registerVideoEditStylePieceRestore(async saved => {
  const store = useVideoEditEffectLibraryStore.getState()
  await store.ready()
  const before = { presets: store.presets, favorites: store.favorites }
  const merged = mergeRecycledMembers(before.presets, saved.presets, 'id', () => crypto.randomUUID())
  const taken = new Set(before.presets.map(preset => preset.name))
  const presets = merged.values.map(preset => {
    if (before.presets.includes(preset)) return preset
    let name = preset.name
    for (let suffix = 2; taken.has(name); suffix++) { const ending = ` (${suffix})`; name = `${preset.name.slice(0, 200 - ending.length)}${ending}` }
    taken.add(name)
    return { ...preset, name }
  })
  const favorites = [...new Set([...before.favorites, ...saved.presets.flatMap((preset, index) => saved.favorites.includes(`preset:${preset.id}`) ? [`preset:${merged.restored[index].id}`] : [])])]
  await store.saveLibrary({ presets, favorites }, before, false)
})
export const VIDEO_EDIT_EFFECT_LIBRARY_SCOPE = 'video_edit.effects'
export function videoEditEffectLibraryRevisions(): Record<string, number> { return { [VIDEO_EDIT_EFFECT_LIBRARY_SCOPE]: useVideoEditEffectLibraryStore.getState().revision } }

/** 智能区域和人物蒙版都要分析片段素材，只能加到视频、图片片段上（内置效果、智能预设、风格件与拖放共用）。 */
export function videoEditEffectNeedsSource(effect: Pick<VideoEditEffect, 'mask' | 'builtin'>): boolean { return isSmartRegionMask(effect.mask) || videoEditEffectNeedsSubject(effect.builtin) }
/** 内置效果与智能预设的模板；风格件走 `applyVideoEditStylePiece`。 */
export function resolveVideoEditLibraryEffects(ref: string): { media: 'video' | 'audio'; effects: Omit<VideoEditEffect, 'id'>[]; needsSource: boolean } | undefined {
  const template = resolveVideoEditEffectTemplate(ref)
  if (!template) return undefined
  const effect: Omit<VideoEditEffect, 'id'> = { name: template.name ?? requireVideoEditBuiltinEffect(template.builtinId).name, enabled: true, amount: 1, builtin: { id: template.builtinId, params: normalizeVideoEditBuiltinParams(template.builtinId, template.params) }, ...(template.mask ? { mask: template.mask } : {}) }
  return { media: videoEditBuiltinEffectMedia(template.builtinId), effects: [effect], needsSource: videoEditEffectNeedsSource(effect) }
}
export type VideoEditLibraryEntry = Omit<VideoEditEffectsRegistryEntry, 'category'> & { category: VideoEditEffectsRegistryEntry['category'] | 'presets'; aliases?: readonly string[]; piece?: VideoEditStylePieceEntry }
/** 效果面板“风格件”文件夹的条目；有风格成员时按“全局 / 风格名”分组，同名项靠分组区分归属。 */
export function videoEditStylePieceLibraryEntries(pieces: readonly VideoEditStylePieceEntry[]): VideoEditLibraryEntry[] {
  const owned = pieces.some(piece => piece.styleId)
  return pieces.map(piece => {
    const { preset } = piece
    return {
      id: piece.ref, name: preset.name, category: 'presets', kind: 'effect', media: preset.media, piece,
      ...(owned ? { group: piece.styleName ?? '全局' } : {}),
      tooltip: preset.description?.trim() || (preset.media === 'audio' ? '将已保存的效果组合加到声音片段' : '将已保存的效果组合加到画面片段'),
      description: [preset.description, preset.usage, piece.styleName, preset.effects.map(effect => `${effect.name} ${effect.builtin?.id ?? ''}`).join(' ')].join(' '),
      aliases: preset.effects.map(effect => effect.builtin?.id.replaceAll('_', ' ') ?? ''),
    }
  })
}
/** Whitespace-separated keywords must all match; accents/case and English IDs are normalized. */
export function filterVideoEditLibraryEntries(entries: readonly VideoEditLibraryEntry[], query: string, folderName = ''): VideoEditLibraryEntry[] {
  const normalize = (value: string): string => value.normalize('NFKC').toLocaleLowerCase()
  const words = normalize(query).trim().split(/\s+/).filter(Boolean)
  return entries.filter(entry => {
    const category = VIDEO_EDIT_EFFECT_CATEGORIES.find(category => category.id === entry.category)?.name ?? '风格件'
    const medium = entry.media === 'audio' ? '音频' : '视频'
    // 风格件在预设面板里叫“效果预设”，两种叫法都能搜到。
    const text = normalize([entry.name, entry.description, category, folderName, entry.category === 'presets' ? `${medium}风格件 ${medium}预设` : '', entry.group, entry.builtinId?.replaceAll('_', ' '), entry.transitionKind?.replaceAll('_', ' '), ...(entry.aliases ?? [])].join(' '))
    return words.every(word => text.includes(word))
  })
}
export function videoEditPresetCreationProperties(preset: VideoEditEffectPreset, styleId?: string): Array<Record<string, unknown>> {
  return resolveVideoEditStylePieceEffects(preset).filter(effect => !effect.builtin || !isRemovedVideoEditBuiltinEffect(effect.builtin.id)).map(effect => ({ 'video_edit.effect.definition_id': effect.builtin ? videoEditBuiltinRefId(effect.builtin.id) : `style-member:${encodeURIComponent(JSON.stringify([styleId ?? null, preset.id, effect.id, renderFingerprintHash(JSON.stringify(preset))]))}`, 'video_edit.effect.parameters': structuredClone(effect.builtin?.params ?? effect.code!.parameters), 'video_edit.effect.name': effect.name, 'video_edit.effect.enabled': effect.enabled, 'video_edit.effect.amount': effect.amount, ...(effect.builtin?.curves ? { 'video_edit.effect.frame_curves': structuredClone(effect.builtin.curves) } : {}), ...(effect.code?.curves ? { 'video_edit.effect.curves': structuredClone(effect.code.curves) } : {}), ...(effect.mask ? { 'video_edit.effect.mask': structuredClone(effect.mask) } : {}) }))
}

export interface VideoEditStylePieceEntry { ref: string; preset: VideoEditEffectPreset; styleId?: string; styleName?: string }
/** 效果面板的“风格件”：全局与当前序列绑定的工程风格副本，保留归属以区分同名项。 */
export function listVideoEditStylePieces(projectId: string, sequenceId: string): VideoEditStylePieceEntry[] {
  const document = listVideoEditInstances().find(owner => owner.document.id === projectId)?.document
  if (!document) return []
  const sequence = document.sequences.find(sequence => sequence.id === sequenceId)
  if (!sequence) return []
  const style = document.styles?.find(style => style.id === sequence.styleId)
  return [
    ...useVideoEditEffectLibraryStore.getState().presets.map(preset => ({ ref: `preset:${preset.id}`, preset })),
    ...(style?.effectPresets ?? []).map(preset => ({ ref: `style-preset:${encodeURIComponent(style!.id)}:${encodeURIComponent(preset.id)}`, preset, styleId: style!.id, styleName: style!.name })),
  ]
}
/** 预设面板按全局风格件 id 取条目，引用由风格件列表给出。 */
export function findVideoEditGlobalStylePiece(projectId: string, sequenceId: string, presetId: string): VideoEditStylePieceEntry | undefined {
  return listVideoEditStylePieces(projectId, sequenceId).find(entry => !entry.styleId && entry.preset.id === presetId)
}
export function resolveVideoEditStylePieceMember(document: VideoEditDocument, ref: string): { preset: VideoEditEffectPreset; effectId: string } {
  const [styleId, presetId, effectId, fingerprint] = parseVideoEditStylePieceMemberRef(ref)
  const preset = styleId === null ? useVideoEditEffectLibraryStore.getState().presets.find(preset => preset.id === presetId) : document.styles?.find(style => style.id === styleId)?.effectPresets?.find(preset => preset.id === presetId)
  if (!preset || renderFingerprintHash(JSON.stringify(preset)) !== fingerprint || !preset.effects.some(effect => effect.id === effectId && effect.code)) throw new Error('风格件已改变或移除，请重新读取 creation_items。')
  return { preset, effectId }
}
function parseVideoEditStylePieceMemberRef(ref: string): [string | null, string, string, string] {
  const value: unknown = JSON.parse(decodeURIComponent(ref.slice('style-member:'.length)))
  if (!Array.isArray(value) || value.length !== 4 || value[0] !== null && typeof value[0] !== 'string' || value.slice(1).some(value => typeof value !== 'string')) throw new Error('风格件成员引用无效。')
  return value as [string | null, string, string, string]
}
