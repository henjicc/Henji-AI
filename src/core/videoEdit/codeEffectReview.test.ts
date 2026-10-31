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
