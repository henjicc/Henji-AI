import type { CodeParameterVisibility } from './parameterTypes'

/** 作者参数、内置效果与预览共用的条件语义。 */
export function parameterVisible(condition: CodeParameterVisibility | undefined, values: Readonly<Record<string, unknown>>): boolean {
  if (!condition) return true
  if ('all' in condition) return condition.all.every(item => parameterVisible(item, values))
  const value = values[condition.param]
  if ('equals' in condition) return value === condition.equals
  if ('notEquals' in condition) return value !== condition.notEquals
  return condition.in?.some(candidate => candidate === value) ?? true
}
export function parameterVisibilityText(condition: CodeParameterVisibility): string {
  if ('all' in condition) return condition.all.map(parameterVisibilityText).join(' 且 ')
  return `${condition.param} ${condition.in ? `为 ${condition.in.join('、')}` : 'notEquals' in condition ? `不为 ${condition.notEquals}` : `为 ${condition.equals}`}`
}
export function mapParameterVisibility(condition: CodeParameterVisibility, key: (value: string) => string): CodeParameterVisibility {
  if ('all' in condition) return { all: condition.all.map(item => ({ ...item, param: key(item.param) })) }
  return { ...condition, param: key(condition.param) }
}
