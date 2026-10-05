import { describe, expect, it } from 'vitest'

import { collectForcedRules, rewriteForcedSelector } from './forcedPseudoStates'

describe('样张页强制伪类状态（任务 5.11）', () => {
  it('把 :hover / :focus-visible / :focus-within 换成强制类，保留其余选择器', () => {
    expect(rewriteForcedSelector('.ui-btn-quiet:hover:not(:disabled)')).toBe('.ui-btn-quiet.henji-gallery-force-hover:not(:disabled)')
    expect(rewriteForcedSelector('.hover\\:bg-hover:hover')).toBe('.hover\\:bg-hover.henji-gallery-force-hover')
    expect(rewriteForcedSelector('.group\\/switch:hover .group-hover\\/switch\\:bg-line-strong'))
      .toBe('.group\\/switch.henji-gallery-force-hover .group-hover\\/switch\\:bg-line-strong')
    expect(rewriteForcedSelector('*:focus-visible')).toBe('*.henji-gallery-force-focus')
    expect(rewriteForcedSelector('.a:focus-within')).toBe('.a.henji-gallery-force-focus')
  })

  it('逗号分组只保留含伪类的部分；否定伪类与无伪类不改写', () => {
    expect(rewriteForcedSelector('.a:hover, .b')).toBe('.a.henji-gallery-force-hover')
    expect(rewriteForcedSelector('.a:not(:hover)')).toBeNull()
    expect(rewriteForcedSelector('.a:is(.b, .c)')).toBeNull()
    expect(rewriteForcedSelector('.a:hover:is(.b, .c)')).toBe('.a.henji-gallery-force-hover:is(.b, .c)')
  })

  it('递归保留 @media 条件，跳过无关规则', () => {
    const rules = [
      { selectorText: '.x', style: { cssText: 'color: red;' } },
      { selectorText: '.y:hover', style: { cssText: 'color: blue;' } },
      { type: 4, conditionText: '(hover: hover)', cssRules: [{ selectorText: '.z:focus-visible', style: { cssText: 'outline: none;' } }] },
    ]
    expect(collectForcedRules(rules)).toEqual([
      '.y.henji-gallery-force-hover { color: blue; }',
      '@media (hover: hover) { .z.henji-gallery-force-focus { outline: none; } }',
    ])
  })
})
