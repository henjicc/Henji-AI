const test = require('node:test')
const assert = require('node:assert/strict')
const { findSymbolGlyphs } = require('./symbolGlyphs.cjs')

test('界面文字里的 emoji 与 ✓ ✗ ▶ 符号会被拦截', () => {
  const source = [
    "const label = '🔒 已锁定'",
    'return <span>{ok ? \'✓\' : \'✗\'}</span>',
    '<span>▶</span>',
    "const title = '⚠️ 警告'",
  ].join('\n')
  assert.deepEqual(findSymbolGlyphs(source).map((item) => [item.line, item.glyph]), [
    [1, '🔒'],
    [2, '✓'],
    [3, '▶'],
    [4, '⚠'],
  ])
})

test('注释、控制台输出与行级豁免不拦截', () => {
  const source = [
    '// ⚠️ 行注释里的说明',
    '/* 块注释 🚀',
    ' * 续行 ✅ */',
    '{/* JSX 注释 ◆ ✓ */}',
    "console.info('🚀 开始')",
    "// icon-token-allow 测试夹具需要原样保留",
    "const fixture = '✅'",
    "const url = 'https://example.com/a' // 字符串里的双斜杠不是注释 ✓",
  ].join('\n')
  assert.deepEqual(findSymbolGlyphs(source), [])
})

test('字符串里的双斜杠不会把后面的代码当成注释吞掉', () => {
  const source = "const url = 'https://example.com'; const mark = '✓'"
  assert.equal(findSymbolGlyphs(source).length, 1)
})

test('排版符号不是图标：破折号、箭头、间隔号放行', () => {
  assert.deepEqual(findSymbolGlyphs("const text = '1 → 2 — 完成 · 共 3 项…'"), [])
})

test('JSON 文案按原文扫描', () => {
  const json = '{\n  "ok": "已完成 ✅",\n  "plain": "已完成"\n}'
  assert.deepEqual(findSymbolGlyphs(json, { json: true }).map((item) => item.line), [2])
})
