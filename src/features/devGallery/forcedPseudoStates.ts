/**
 * 组件样张页的“强制伪类状态”（任务 5.11，只在开发样张页挂载期间生效）。
 *
 * 做法与 Storybook 的 storybook-addon-pseudo-states 相同：把样式表里含 `:hover` / `:focus-visible` /
 * `:focus-within` 的规则复制一份，伪类换成普通类（`henji-gallery-force-*`），再把这个类挂到要展示的元素上。
 * 这样悬停、聚焦态不依赖鼠标与真实焦点，截图稳定；组件本身的样式一行不改，展示的就是正式样式。
 *
 * - 只追加规则，不改原规则；样张页卸载时移除追加的 `<style>`，正式界面不受影响。
 * - `:not(:hover)` 这类否定伪类不改写（改写后会对所有非强制元素生效，反而盖掉真实悬停）。
 */

export type GalleryForcedState = 'hover' | 'focus'

export const GALLERY_FORCED_STATE_CLASS: Record<GalleryForcedState, string> = {
  hover: 'henji-gallery-force-hover',
  focus: 'henji-gallery-force-focus',
}

const PSEUDO_TO_CLASS: ReadonlyArray<[RegExp, string]> = [
  [/:hover\b/g, `.${GALLERY_FORCED_STATE_CLASS.hover}`],
  [/:focus-visible\b/g, `.${GALLERY_FORCED_STATE_CLASS.focus}`],
  [/:focus-within\b/g, `.${GALLERY_FORCED_STATE_CLASS.focus}`],
]

const FORCEABLE = /:(hover|focus-visible|focus-within)\b/
const NEGATED = /:not\([^)]*:(hover|focus-visible|focus-within)/

/** 单个选择器（可含逗号分组）→ 强制类版本；没有可改写的伪类时返回 null。 */
export function rewriteForcedSelector(selectorText: string): string | null {
  const parts = selectorText
    .split(/,(?![^(]*\))/)
    .map((part) => part.trim())
    .filter((part) => FORCEABLE.test(part) && !NEGATED.test(part))
    .map((part) => PSEUDO_TO_CLASS.reduce((acc, [pattern, cls]) => acc.replace(pattern, cls), part))
  return parts.length > 0 ? parts.join(', ') : null
}

interface RuleLike {
  cssRules?: ArrayLike<RuleLike>
  selectorText?: string
  style?: { cssText: string }
  conditionText?: string
  type?: number
}

const MEDIA_RULE = 4
const SUPPORTS_RULE = 12

/** 递归收集改写后的规则文本（保留外层 @media / @supports 条件）。 */
export function collectForcedRules(rules: ArrayLike<RuleLike>, wrap: (css: string) => string = (css) => css): string[] {
  const out: string[] = []
  for (let i = 0; i < rules.length; i += 1) {
    const rule = rules[i]
    if (rule.selectorText && rule.style) {
      const selector = rule.selectorText.includes(':') ? rewriteForcedSelector(rule.selectorText) : null
      if (selector && rule.style.cssText) out.push(wrap(`${selector} { ${rule.style.cssText} }`))
      continue
    }
    if (rule.cssRules && rule.conditionText !== undefined && (rule.type === MEDIA_RULE || rule.type === SUPPORTS_RULE)) {
      const at = rule.type === MEDIA_RULE ? '@media' : '@supports'
      out.push(...collectForcedRules(rule.cssRules, (css) => wrap(`${at} ${rule.conditionText} { ${css} }`)))
    }
  }
  return out
}

/** 在文档里追加强制状态样式，返回卸载函数。跨源样式表（读不到 cssRules）跳过。 */
export function installForcedPseudoStates(doc: Document): () => void {
  const css: string[] = []
  for (const sheet of Array.from(doc.styleSheets)) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      continue
    }
    css.push(...collectForcedRules(rules as unknown as ArrayLike<RuleLike>))
  }
  const style = doc.createElement('style')
  style.setAttribute('data-gallery-forced-states', '')
  style.textContent = css.join('\n')
  doc.head.appendChild(style)
  return () => style.remove()
}
