import { CodeMaterialError, type CodeParameterDeclaration, type CodeParameterTypeDefinition } from '@/core/videoEdit/codeMaterial/contract'
import { parseCodeMaterialTypes, parseCodeMaterialV3Parameters } from '@/core/videoEdit/codeMaterial/parameterTypes'
import type { AuthorModule, AuthorParameters } from './videoEditAuthorModule'

export interface AuthorParameterMetadata {
  parameters: CodeParameterDeclaration[]
  types: Record<string, CodeParameterTypeDefinition>
  hexColors: string[]
}

export interface AuthorEffectMetadata extends AuthorParameterMetadata {
  name: string
  kind: 'generator' | 'filter'
  mode: 'static' | 'dynamic'
  width?: number
  height?: number
  durationSeconds?: number
  frames: number[]
}

/** Read from the executed module in the render worker; absent placement hints
 * remain absent, rather than silently imposing a canvas or source duration.
 * `apiVersion` 是代码版本的作者接口版本（省略即 4）：v5 起才认片子数据参数，v4 代码里的同名自定义类型照旧有效。 */
export function authorEffectMetadata(effect: AuthorModule, apiVersion?: number): AuthorEffectMetadata {
  if (effect.kind !== undefined && effect.kind !== 'generator' && effect.kind !== 'filter') throw new Error('效果 kind 必须为 generator 或 filter。')
  if (effect.mode !== undefined && effect.mode !== 'static' && effect.mode !== 'dynamic') throw new Error('效果 mode 必须为 static 或 dynamic。')
  const hints: Pick<AuthorEffectMetadata, 'width' | 'height' | 'durationSeconds'> = {}
  for (const key of ['width', 'height', 'durationSeconds'] as const) {
    const value = effect[key]
    if (value === undefined) continue
    if (!Number.isFinite(value) || value <= 0 || key !== 'durationSeconds' && !Number.isSafeInteger(value)) throw new Error(`效果 ${key} 必须为有效正数。`)
    hints[key] = value
  }
  const frames = [...(effect.frames ?? [])]
  if (frames.some(offset => !Number.isFinite(offset) || offset === 0) || new Set(frames).size !== frames.length) throw new Error('相邻帧偏移必须为不重复的非零有限数值。')
  return { name: effect.name, kind: effect.kind ?? 'generator', mode: effect.mode ?? 'dynamic', frames, ...hints, ...authorParameterMetadata(effect, apiVersion) }
}

/** Only control metadata is normalized. The author module has already executed
 * as ordinary JS; none of its drawing or control flow is parsed here. */
export function authorParameterMetadata(effect: Pick<AuthorModule, 'params' | 'types'>, apiVersion?: number): AuthorParameterMetadata {
  const types = parseCodeMaterialTypes(effect.types ?? {}, apiVersion)
  const parameters: Record<string, unknown> = Object.create(null)
  const hexColors: string[] = []
  for (const parameter of effect.params ?? []) {
    const { key, label, labelEnglish: _labelEnglish, nameEnglish: _nameEnglish, ...raw } = parameter
    if (Object.hasOwn(parameters, key)) throw new CodeMaterialError('PARAMETERS', `参数 ${key} 重复。`)
    const item: Record<string, unknown> = { ...raw, title: raw.title ?? label ?? key }
    if (item.type === 'range' && !Array.isArray(item.default)) item.type = 'number'
    if (item.type === 'select') item.type = 'choice'
    if (Array.isArray(item.options)) item.options = item.options.map(option => {
      if (option && typeof option === 'object' && !Array.isArray(option)) {
        const value = option as Record<string, unknown>
        return { value: value.value, label: value.label ?? value.value }
      }
      return option
    })
    if (item.type === 'color' && typeof item.default === 'string') {
      const hex = item.default
      if (!/^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(hex)) throw new CodeMaterialError('PARAMETERS', `${key} 颜色需要 #RRGGBB 或 #RRGGBBAA。`)
      item.default = [1, 3, 5, 7].map(index => index < hex.length ? parseInt(hex.slice(index, index + 2), 16) / 255 : 1)
      hexColors.push(key)
    }
    if (item.type === 'text') { item.default ??= ''; item.maxLength ??= 4096 }
    if (item.type === 'image' || item.type === 'audio') item.default = null
    if (item.type === 'textStyle') item.default ??= {}
    if (item.type === 'table') item.default ??= []
    Object.defineProperty(parameters, key, { value: item, enumerable: true })
  }
  return { parameters: parseCodeMaterialV3Parameters(parameters, types, apiVersion), types, hexColors }
}

/** UI stores shared RGBA values; unchanged Frameflow code still receives CSS hex.
 * This is once per effect frame, never once per Canvas operation. */
export function authorParameterValues(metadata: AuthorParameterMetadata, values: AuthorParameters): AuthorParameters {
  const result: Record<string, unknown> = Object.fromEntries(metadata.parameters.map(parameter => [parameter.key, parameter.default]))
  Object.assign(result, values)
  for (const key of metadata.hexColors) {
    const color = result[key]
    if (Array.isArray(color) && color.length === 4) {
      const channels = color as number[]
      result[key] = `#${channels.slice(0, channels[3] === 1 ? 3 : 4).map(channel => Math.round(Math.min(1, Math.max(0, channel)) * 255).toString(16).padStart(2, '0')).join('')}`
    }
  }
  return result
}
