import type { CodeMaterialInstance } from './codeMaterialPersistence'
import { isCodeImageReference, isCodeAudioReference } from './codeMaterial/contract'
import type { CodeAuthorProgram } from './codeAuthorProgram'
import type { CodeImageReference, CodeParameterDeclaration } from './codeMaterial/contract'

/** 画面语义只由声明与明确的片子数据派生项决定，自定义结构的字段名不参与判断。 */
export function codeMaterialImageParameterKeys(declarations: readonly CodeParameterDeclaration[], derived: Readonly<Record<string, CodeImageReference>> = {}): ReadonlySet<string> {
  return new Set([...declarations.flatMap(parameter => parameter.type === 'image' ? [parameter.key] : []), ...Object.keys(derived)])
}

/**
 * 声明了 audio 参数，或代码里读了 `info.audio` / `audioTime`（不声明时宿主给默认混音的分析）都算用到声音。
 * 按源码文字宽松判断：误判只多做一次声音分析，漏判则作者拿不到声音、缓存也会把随声音变的画面当成不变。
 */
export function codeMaterialUsesAudio(program: CodeAuthorProgram): boolean {
  const sources = [program.bundle.code, ...Object.values(program.bundle.modules?.files ?? {})]
  return program.parameters.some(parameter => parameter.type === 'audio') || sources.some(source => /\baudio(?:Time)?\b/.test(source))
}
/** 运行期传入声明以确定语义；未加载源码的文档依赖扫描仅收集可验证的引用标识。 */
export function codeMaterialImageIds(instance?: CodeMaterialInstance, declarations?: readonly CodeParameterDeclaration[], derived: Readonly<Record<string, CodeImageReference>> = {}): Set<string> {
  const parameters = { ...instance?.parameters, ...derived }
  const keys = declarations ? codeMaterialImageParameterKeys(declarations, derived) : Object.keys(parameters)
  return new Set([...keys].flatMap(key => { const value = parameters[key]; return isCodeImageReference(value) && (value.kind === 'image' || value.kind === 'video') ? [value.mediaId] : [] }))
}

export function codeMaterialMediaIds(instance?: CodeMaterialInstance): Set<string> {
  return new Set([...codeMaterialImageIds(instance), ...Object.values(instance?.parameters ?? {}).flatMap(value => isCodeAudioReference(value) ? [value.mediaId] : [])])
}
