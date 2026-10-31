import ts from 'typescript'
import { expect, it } from 'vitest'
import { reviewCodeEffectUsage } from './codeEffectReview'
it('建议只针对真实绘制赋值，不命中注释、文本与无关对象，保留位置和证据', () => {
  const source = `// ctx.shadowBlur = 90
const text = 'ctx.filter = "blur(20px)"'; const unrelated = { shadowBlur: 1 }; unrelated.shadowBlur = 8;
export default { draw(ctx) { const paint = ctx; paint["filter"] = \`blur(3px)\`; paint.shadowBlur = 0; } }`
  const suggestions = reviewCodeEffectUsage(ts.createSourceFile('effect.ts', source, ts.ScriptTarget.Latest, true))
  expect(suggestions).toHaveLength(1)
  expect(suggestions[0]).toMatchObject({ file: 'effect.ts', line: 3, factory: 'blur', confidence: 'static_assignment' })
})

it('动态阴影和循环叠光给出源码候选，关闭阴影不误报', () => {
  const source = ts.createSourceFile('light.ts', `export default { draw(ctx, t) { ctx.shadowBlur = t * 4; ctx.globalCompositeOperation = 'lighter'; for (let i=0;i<4;i++) ctx.drawImage(image, x+i, y-i); } }`, ts.ScriptTarget.Latest, true)
  const suggestions = reviewCodeEffectUsage(source)
  expect(suggestions.some(item => item.confidence === 'structural_candidate' && item.evidence.includes('shadowBlur'))).toBe(true)
  expect(suggestions.some(item => item.factory === 'glow' && item.confidence === 'structural_candidate')).toBe(true)
  expect(reviewCodeEffectUsage(ts.createSourceFile('off.ts', 'export default { draw(ctx) { ctx.shadowBlur = 0 } }', ts.ScriptTarget.Latest, true))).toEqual([])
})

it('识别模板与拼接 filter，偏移投影不降格为发光，正负零不报', () => {
  const source = ts.createSourceFile('filters.ts', 'export default { draw(ctx,t) { ctx.filter = `blur(${t}px)`; ctx.filter = "bl" + "ur(" + t + "px)"; ctx.shadowOffsetX = 8; ctx.shadowBlur = t * 2; ctx.shadowBlur = (-0); } }', ts.ScriptTarget.Latest, true)
  const suggestions = reviewCodeEffectUsage(source)
  expect(suggestions.filter(item => item.factory === 'blur')).toHaveLength(2)
  expect(suggestions.every(item => item.confidence === 'structural_candidate')).toBe(true)
  expect(suggestions.some(item => item.factory === 'glow')).toBe(false)
  expect(suggestions.some(item => item.evidence.includes('(-0)'))).toBe(false)
})
