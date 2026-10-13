const { test } = require('node:test')
const assert = require('node:assert/strict')
const { findDesignRules, findUnusedTokens } = require('./uiDesignRules.cjs')

test('间距九档覆盖变体、important、负数、任意值、TS常量、style与CSS', () => {
  for (const source of ['const X_CLASS="hover:!gap-2.5 -mt-3.5"', '<div style={{padding: 10}}/>', '<div className="p-[10px]"/>']) assert.ok(findDesignRules(source, 'src/demo.tsx').some(x => x.rule === 'spacingScale'))
  assert.ok(findDesignRules('.x { gap: 10px; }', 'src/demo.css').some(x => x.rule === 'spacingScale'))
  assert.equal(findDesignRules('<div className="p-3 -mt-2 gap-1.5 gap-[var(--gap)]" style={{padding: 12}}/>', 'src/demo.tsx').length, 0)
})

test('CSS与内联动效：档位变量、布局例外、循环与减弱动画', () => {
  for (const css of ['.x { transition: opacity 150ms ease-in; }', '.x { transition: height var(--ui-duration-base) var(--ui-ease); }']) assert.ok(findDesignRules(css, 'src/demo.css').length)
  assert.equal(findDesignRules('.x { animation: spin var(--ui-loop-spin) linear infinite; transition: opacity var(--ui-duration-base) var(--ui-ease); }', 'src/demo.css').length, 0)
  assert.ok(findDesignRules('const style={ transition: uiTransition(["width"], UI_DURATION.base) }', 'src/demo.tsx').some(x => x.rule === 'layoutTransition'))
  assert.equal(findDesignRules('const style={ transition: uiTransition(["width"], UI_DURATION.base) }', 'src/components/ui/fileUploader/StackedMediaUploader.tsx').length, 0)
  assert.ok(findDesignRules('<div className="transition-all duration-150"/>', 'src/demo.tsx').length)
})

test('手写退出状态计时与业务等待区分', () => {
  assert.ok(findDesignRules('useEffect(()=>{if(!open){setVisible(false);setTimeout(()=>setMounted(false),180)}},[open])', 'src/demo.tsx').some(x => x.rule === 'manualExit'))
  assert.equal(findDesignRules('useEffect(()=>{setTimeout(()=>setNotification(null),3000)},[])', 'src/demo.tsx').length, 0)
})

test('死令牌忽略测试与样张自动枚举，覆盖JS、CSS与Tailwind登记', () => {
  const files = { 'src/components/ui/styleTokens.ts': 'export const UI_DEAD_CLASS="gap-2"; export const UI_USED_CLASS="gap-3";', 'src/index.css': ':root { --ui-dead: 1; --ui-used: 2; } .a {gap:var(--ui-used)}', 'tailwind.config.js': 'module.exports={theme:{extend:{spacing:{dead:"var(--ui-dead)"}}}}', 'src/demo.tsx': '<div className={UI_USED_CLASS}/>', 'src/demo.test.ts': 'UI_DEAD_CLASS', 'src/features/devGallery/tokenSections.tsx': 'Object.entries(UI_DEAD_CLASS)' }
  const hits = findUnusedTokens(files)
  assert.ok(hits.some(x => x.value === 'UI_DEAD_CLASS'))
  assert.ok(hits.some(x => x.value === '--ui-dead'))
  assert.ok(!hits.some(x => x.value === 'UI_USED_CLASS' || x.value === '--ui-used'))
  files['src/onlyImport.ts'] = 'import { UI_DEAD_CLASS } from "./styleTokens"; export { UI_DEAD_CLASS }; // UI_DEAD_CLASS'
  assert.ok(findUnusedTokens(files).some(x => x.value === 'UI_DEAD_CLASS'), '仅导入、转导与注释不能冒充消费')
})
