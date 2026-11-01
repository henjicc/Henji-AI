import { createLogger } from '@/core/logging'
import type { CodeAuthorBundle } from '@/core/videoEdit/codeAuthorProgram'
import { CODE_AUTHOR_SHAPED_TEXT_MIN_API_VERSION } from '@/core/videoEdit/codeAuthorVersions'
import type { CodeMaterialInstance, CodeMaterialVersion } from '@/core/videoEdit/codeMaterialPersistence'
import { codeMaterialSource, codeMaterialVersion } from '@/core/videoEdit/codeMaterialDocument'
import { codeVersionContentKey, loadCodeSourceReferences } from '@/core/videoEdit/codeMaterial/sources'
import { resolveTextFontPreparation } from '@/core/videoEdit/codeMaterial/textFontPreparation'
import { activeVideoEditClips, videoEditPictureTransitionsAt, type VideoEditComposition } from '@/core/videoEdit/document'
import { activeVideoEditEffects } from '@/core/videoEdit/compositing'
import { videoEditTransitionPictureClips } from '@/core/videoEdit/transitions'
import { videoEditNestedFrame } from '@/core/videoEdit/nestedSequences'
import type { TextFontDeclaration } from '@/core/imaging/vectorContent/shaping/fontSession'
import { prepareVideoEditAuthorBundle } from './videoEditSharedCompiler'

const logger = createLogger('features.videoEdit.textPreflight')
export interface TextPreflightRequest { version: string; declaration: TextFontDeclaration; optional?: boolean }

/**
 * 内容更新时判定一次：只有引用文字新版接口代码的工程才在逐帧路径预检，旧接口工程逐帧不遍历片段、不编译元数据。
 * 缺失的版本引用不在这里报错，由正式渲染报告。
 */
export function needsVideoEditTextPreflight(document: VideoEditComposition): boolean {
  const shaped = (instance: CodeMaterialInstance | undefined): boolean => !!instance && (document.codeMaterials?.find(definition => definition.id === instance.definitionId)
    ?.versions.find(version => version.id === instance.versionId)?.apiVersion ?? 0) >= CODE_AUTHOR_SHAPED_TEXT_MIN_API_VERSION
  return [document, ...document.sequences ?? []].some(sequence => sequence.clips.some(clip => shaped(clip.code) || clip.effects?.some(effect => shaped(effect.code))))
}

/** 预检只读取编译期元数据；作者模块只由正式渲染路径装载。 */
export class VideoEditTextPreflight {
  private readonly bundles = new Map<string, CodeAuthorBundle | Promise<CodeAuthorBundle>>()
  private readonly prepared = new Map<string, Promise<void> | true>()
  private readonly controller = new AbortController()
  private ready?: Promise<void> | true
  constructor(private readonly send: (requests: TextPreflightRequest[], signal: AbortSignal) => Promise<void>, private readonly initialize?: () => Promise<void>) {}
  invalidate(): void { this.prepared.clear() }
  close(): void { this.controller.abort(); this.bundles.clear(); this.prepared.clear() }
  prepare(document: VideoEditComposition, frame: number, revision: number | (() => number)): Promise<void> | undefined {
    const instances: Array<{ instance: CodeMaterialInstance; version: CodeMaterialVersion; optional: boolean }> = []
    const visit = (sequence: VideoEditComposition, frame: number, seen: Set<string>): void => {
      if (seen.has(sequence.id)) return
      seen = new Set([...seen, sequence.id])
      const clips = [...new Map([...activeVideoEditClips(sequence, frame), ...videoEditPictureTransitionsAt(sequence, frame).flatMap(videoEditTransitionPictureClips)].map(clip => [clip.id, clip])).values()]
      for (const clip of clips) {
        for (const instance of [...clip.code ? [clip.code] : [], ...activeVideoEditEffects(clip).flatMap(effect => effect.code ? [effect.code] : [])]) {
          const version = codeMaterialVersion(document, instance)
          if (version.apiVersion >= CODE_AUTHOR_SHAPED_TEXT_MIN_API_VERSION) instances.push({ instance, version, optional: instance !== clip.code })
        }
        const id = document.items.find(item => item.id === clip.itemId)?.sequenceId
        const nested = id && document.sequences?.find(sequence => sequence.id === id)
        if (nested) {
          const composition = { ...document, ...nested, transitions: nested.transitions, fps: nested.frameRate.numerator / nested.frameRate.denominator }
          visit(composition, videoEditNestedFrame(sequence, clip, composition, frame), seen)
        }
      }
    }
    visit(document, frame, new Set())
    const pending: Promise<CodeAuthorBundle | undefined>[] = []
    const compiled: Array<{ bundle: CodeAuthorBundle; instance: CodeMaterialInstance; optional: boolean }> = []
    for (const { instance, version, optional } of instances) {
      const key = codeVersionContentKey(version)
      let bundle = this.bundles.get(key)
      if (!bundle) {
        const work = loadCodeSourceReferences(version).then(() => prepareVideoEditAuthorBundle(codeMaterialSource(document, instance).compilation, this.controller.signal))
        bundle = work; this.bundles.set(key, work)
        void work.then(value => { if (!this.controller.signal.aborted) this.bundles.set(key, value) }, () => { this.bundles.delete(key) })
      }
      if (bundle instanceof Promise) pending.push(bundle.then(value => { compiled.push({ bundle: value, instance, optional }); return value }, error => {
        if (!optional || this.controller.signal.aborted) throw error
        logger.debug('滤镜字体预检失败，交由正式渲染报告', { event: 'video_edit.text_fonts.effect_skipped', error })
        return undefined
      }))
      else compiled.push({ bundle, instance, optional })
    }
    const prepare = (): Promise<void> | undefined => {
      this.controller.signal.throwIfAborted()
      const requests = compiled.flatMap(({ bundle, instance, optional }) => {
        try {
          const library = bundle.libraries?.['henji-layout']
          if (!library || Number(library.split('.')[0]) < 2 || !bundle.textFonts?.some(resource => resource.usesText)) return []
          // 文本和字体曲线的所有端点属于同一参数身份，播放到端点时不再走一次往返。
          const values = [instance.parameters, ...Object.entries(instance.curves ?? {}).flatMap(([key, points]) => points.map(point => ({ ...instance.parameters, [key]: point.value })))]
          return bundle.textFonts.filter(resource => resource.usesText !== false || resource.parameters?.length || resource.styleUses?.length).flatMap(resource =>
            (resource.file === bundle.textEntry ? values : [undefined]).map(value => ({ version: library, declaration: resolveTextFontPreparation(resource, value), optional })))
        } catch (error) {
          if (!optional) throw error
          logger.debug('滤镜字体参数无效，交由正式渲染报告', { event: 'video_edit.text_fonts.effect_skipped', error })
          return []
        }
      })
      if (requests.length && this.initialize && this.ready !== true) {
        this.ready ??= this.initialize().then(() => { this.ready = true }, error => { this.ready = undefined; throw error })
        return this.ready.then(prepare)
      }
      const currentRevision = typeof revision === 'function' ? revision() : revision
      const unique = new Map(requests.map(request => [JSON.stringify([currentRevision, request]), request]))
      const missing = [...unique].filter(([key]) => !this.prepared.has(key))
      if (missing.length) {
        const work = this.send(missing.map(([, request]) => request), this.controller.signal).then(() => {
          for (const [key] of missing) if (this.prepared.get(key) === work) this.prepared.set(key, true)
        }, error => { for (const [key] of missing) if (this.prepared.get(key) === work) this.prepared.delete(key); throw error })
        for (const [key] of missing) this.prepared.set(key, work)
      }
      const waiting = [...new Set([...unique.keys()].map(key => this.prepared.get(key)).filter((work): work is Promise<void> => work instanceof Promise))]
      for (const [key, value] of this.prepared) { if (this.prepared.size <= 128) break; if (value === true) this.prepared.delete(key) }
      return waiting.length ? Promise.all(waiting).then(() => undefined) : undefined
    }
    return pending.length ? Promise.all(pending).then(prepare) : prepare()
  }
}
