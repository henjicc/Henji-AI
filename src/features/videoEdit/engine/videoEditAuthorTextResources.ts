import type { CodeAuthorBundle } from '@/core/videoEdit/codeAuthorProgram'
import { CODE_AUTHOR_SHAPED_TEXT_MIN_API_VERSION } from '@/core/videoEdit/codeAuthorVersions'
import { prepareTextFontResources } from '@/core/videoEdit/codeMaterial/textFontPreparation'
import { fontRequestKey, type FontChain, type TextFontAccess } from '@/core/imaging/vectorContent/shaping/fontSession'
import type { StaticTextFonts } from '@/core/videoEdit/codeMaterial/textFonts'
import type { TextFontLease } from '@/core/imaging/vectorContent/shaping/fontChannel'
import { acquireSharedTextFontLease } from './videoEditTextFontChannel'
import type { AuthorModule, AuthorParameters } from './videoEditAuthorModule'
import { createLogger } from '@/core/logging'
import { recordVideoEditPreparation } from './videoEditPreparationTiming'

const logger = createLogger('features.videoEdit.authorTextResources')
const resources = new WeakMap<AuthorModule, AuthorTextResources>()
export interface PreparedAuthorText { identity: string; fonts: TextFontAccess }

/** 模块持有租约，实例只借用；释放实例不能关闭仍供其他实例使用的字体。 */
export class AuthorTextResources {
  private identity = ''
  private closed = false
  private readonly cleanups = new Set<() => void>()
  private readonly reported = new Set<string>()
  private declarations: Array<{ file: string } & StaticTextFonts>
  fonts: TextFontAccess
  constructor(private readonly lease: TextFontLease, private readonly bundle: CodeAuthorBundle) {
    this.declarations = [...bundle.textFonts ?? []]
    this.fonts = this.access(new Map())
  }
  private access(chains: ReadonlyMap<string, FontChain>): TextFontAccess {
    return {
      owner: this,
      diagnostics: () => [...this.reported].map(key => `字体组合 ${key} 未提前声明，使用最近的已准备字形或默认字体；需要精确样式请补 textFonts.faces/bindings`),
      onClose: cleanup => { if (this.closed) cleanup(); else this.cleanups.add(cleanup) },
      chain: (request = { family: 'sans-serif' }) => {
        if (this.closed) throw new Error('文字字体资源已经释放')
        const key = fontRequestKey(request)
        let chain = chains.get(key)
        if (!chain) {
          chain = this.lease.fonts.matchPrepared(request, chains) ?? this.lease.fonts.matchPrepared({ ...request, family: 'sans-serif' }, chains)
          if (chain && !this.reported.has(key)) {
            this.reported.add(key)
            logger.warn('文字使用最近的已准备字形或默认字体', { event: 'video_edit.text_fonts.match.fallback', context: { module: this.entry, request } })
          }
        }
        if (!chain) throw new Error(`模块 ${this.entry} 未声明并准备字体：${request.family}`)
        return chain
      },
      choose: (...args) => this.lease.fonts.choose(...args),
    }
  }
  private get entry(): string { return this.bundle.textEntry ?? this.bundle.modules?.entry ?? '' }
  bind(effect: AuthorModule): void {
    resources.set(effect, this)
    const entry = this.declarations.find(resource => resource.file === this.entry)
    if (entry) {
      const parameters: NonNullable<StaticTextFonts['parameters']> = (effect.params ?? []).flatMap(parameter => parameter.type === 'font' || parameter.type === 'textStyle' ? [{ key: parameter.key, type: parameter.type }] : [])
      this.declarations = this.declarations.map(resource => resource === entry ? { ...entry, defaults: Object.fromEntries((effect.params ?? []).map(parameter => [parameter.key, parameter.default ?? (parameter.type === 'textStyle' ? {} : parameter.type === 'text' ? '' : undefined)])), parameters } : resource)
    }
  }
  async prepare(values?: AuthorParameters, signal?: AbortSignal): Promise<PreparedAuthorText> {
    if (this.closed) throw new Error('文字字体资源已经释放')
    const started = performance.now()
    logger.debug('文字字体准备开始', { event: 'video_edit.text_fonts.prepare.start' })
    try {
      const declarations = this.declarations.length ? this.declarations : [{ file: this.entry, declaration: {}, diagnostics: [] }]
      const { identity, chains } = await prepareTextFontResources(this.lease.fonts, declarations, this.entry, values, signal)
      if (this.closed) throw new Error('文字字体资源已经释放')
      this.fonts = this.access(chains)
      this.identity = identity
      recordVideoEditPreparation('fontLoad', performance.now() - started)
      logger.debug('文字字体准备完成', { event: 'video_edit.text_fonts.prepare.completed', context: { durationMs: performance.now() - started } })
      return { identity, fonts: this.fonts }
    } catch (error) {
      logger.warn('文字字体准备失败', { event: 'video_edit.text_fonts.prepare.failed', error })
      throw error
    }
  }
  get contentIdentity(): string { return this.identity }
  close(): void {
    if (this.closed) return
    this.closed = true
    try { for (const cleanup of this.cleanups) cleanup() }
    finally { this.cleanups.clear(); this.lease.release() }
  }
}

/** 只有文字新版接口且导入 henji-layout 2 的模块持有文字资源；其余模块的逐帧路径据此同步跳过文字准备。 */
export function authorBundleShapesText(bundle: CodeAuthorBundle | undefined): boolean {
  if ((bundle?.apiVersion ?? 4) < CODE_AUTHOR_SHAPED_TEXT_MIN_API_VERSION) return false
  const version = bundle?.libraries?.['henji-layout']
  return !!version && Number(version.split('.')[0]) >= 2
}
export async function prepareAuthorTextResources(bundle: CodeAuthorBundle | undefined): Promise<AuthorTextResources | undefined> {
  if (!bundle || !authorBundleShapesText(bundle)) return undefined
  if (!bundle.textFonts) throw new Error(`作者 API ${bundle.apiVersion} 缺少编译期字体声明，请重新编译`)
  const resource = new AuthorTextResources(await acquireSharedTextFontLease(bundle.libraries!['henji-layout']), bundle)
  try { await resource.prepare(); return resource } catch (error) { resource.close(); throw error }
}
/** 没有文字资源的模块返回 undefined 而不是已完成的 Promise，调用方不必为旧接口多等一轮微任务。 */
export function prepareAuthorTextParameters(effect: AuthorModule, params: AuthorParameters, signal?: AbortSignal): Promise<PreparedAuthorText> | undefined {
  return resources.get(effect)?.prepare(params, signal)
}
export async function authorTextMetadataKey(bundle: CodeAuthorBundle, source: string): Promise<string> {
  const resource = await prepareAuthorTextResources(bundle)
  try { return resource ? JSON.stringify([source, resource.contentIdentity]) : source }
  finally { resource?.close() }
}
