import { fontRequestKey, type FontChain, type TextFontDeclaration, type TextFontRequest, type TextFontSession } from '../../imaging/vectorContent/shaping/fontSession'
import { textStyleSchema } from '../../imaging/vectorContent/text'
import { richTextContentSchema } from '../../imaging/vectorContent/schema'
import type { StaticTextFonts } from './textFonts'

/** 参数属于声明所在模块；宿主只向入口模块传本次有效参数，依赖模块使用自身默认值。 */
export function resolveTextFontPreparation(resource: StaticTextFonts, values: Readonly<Record<string, unknown>> = {}): TextFontDeclaration {
  const parameters = { ...resource.defaults, ...values }
  const faces = new Map<string, TextFontRequest>()
  const text = [...resource.declaration.text ?? []]
  const addFace = (face: TextFontRequest): void => { faces.set(fontRequestKey(face), face) }
  // 显式字体不能取代默认字体；同一模块可以同时调用默认 layoutText。
  for (const weight of [400, 700]) for (const style of ['normal', 'italic'] as const) addFace({ family: 'sans-serif', weight, style })
  for (const face of resource.declaration.faces ?? []) addFace(face)
  const addStyle = (value: unknown): void => {
    if (typeof value === 'string') { addFace({ family: value }); return }
    const style = textStyleSchema.parse(value)
    addFace({ family: style.fontFamily, weight: style.fontWeight, style: style.fontStyle })
  }
  for (const parameter of resource.parameters ?? []) {
    const value = parameters[parameter.key]
    if (value !== undefined) addStyle(value)
  }
  for (const use of resource.styleUses ?? []) {
    const base = use.parameter ? parameters[use.parameter] : undefined
    addStyle({ ...(base && typeof base === 'object' ? base : {}), ...use.style })
  }
  for (const binding of resource.declaration.bindings ?? []) {
    const style = parameters[binding.style], value = parameters[binding.text]
    if (style !== undefined) addStyle(style)
    if (typeof value === 'string') text.push(value)
    else if (value !== undefined) {
      const content = richTextContentSchema.parse(value)
      for (const paragraph of content.paragraphs) for (const run of paragraph.runs) {
        text.push(run.text); addStyle(run.style)
      }
    }
  }
  const collectText = (value: unknown): void => {
    if (typeof value === 'string') {
      text.push(value)
      // 作者可能对参数文字 JSON.parse，转义只有解析后才是实际字符。
      if (/^\s*["[{]/.test(value)) {
        try { collectText(JSON.parse(value)) } catch { /* 普通文字不要求是 JSON。 */ }
      }
    }
    else if (Array.isArray(value)) value.forEach(collectText)
    else if (value && typeof value === 'object') Object.values(value).forEach(collectText)
  }
  for (const key of resource.textParameters ?? []) collectText(parameters[key])
  if (resource.dynamicText) return { faces: [...faces.values()], text: undefined, scripts: undefined }
  // allCaps/smallCaps 与作者的 toUpperCase 按大写形式选字体。
  const unique = new Set(text)
  for (const value of [...unique]) unique.add(value.toUpperCase())
  return { faces: [...faces.values()], text: [...unique], scripts: resource.declaration.scripts }

}

/** 全部依赖准备完成才交付内容身份；失败不会给调用者半就绪结果。 */
export async function prepareTextFontResources(fonts: TextFontSession, resources: readonly ({ file: string } & StaticTextFonts)[], entry: string, values?: Readonly<Record<string, unknown>>, signal?: AbortSignal): Promise<{ identity: string; chains: ReadonlyMap<string, FontChain> }> {
  const required = resources.filter(resource => resource.usesText !== false || resource.parameters?.length || resource.styleUses?.length)
  const declarations = required.length ? required.map(resource => {
    try { return resolveTextFontPreparation(resource, resource.file === entry ? values : undefined) }
    catch (cause) { throw new Error(`模块 ${resource.file} 的文字字体参数无效：${cause instanceof Error ? cause.message : String(cause)}`, { cause }) }
  }) : [resolveTextFontPreparation({ declaration: {}, diagnostics: [] })]
  // 静态分析证明为空的文字不需要候选；只有动态文字或没有任何分析结果才准备完整默认集。
  const unspecified = !required.length || declarations.some(declaration => declaration.text === undefined)
  const chains = await fonts.prepare({ faces: [...new Map(declarations.flatMap(declaration => declaration.faces!.map(face => [fontRequestKey(face), face] as const))).values()],
    text: unspecified ? undefined : declarations.flatMap(declaration => declaration.text ?? []), scripts: unspecified ? undefined : declarations.flatMap(declaration => declaration.scripts ?? []) }, signal)
  return { identity: JSON.stringify([...chains.values()].map(chain => chain.identity).sort()), chains }
}
