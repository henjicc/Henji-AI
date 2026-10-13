const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { ESLint } = require('eslint')
const { findUiSurfaceGrammar, MESSAGES } = require('./uiSurfaceGrammar.cjs')
const { requiredContrast } = require('./uiContrastAudit.cjs')
const read = file => fs.readFileSync(path.resolve(file), 'utf8')

test('S1 中文四字、英文十二字符边界；未知动态标签不猜测', () => {
  const check = label => findUiSurfaceGrammar(`<UiSegmented options={[{value: 'a', label: '${label}'}]} />`).some(hit => hit.rule === 'S1')
  assert.equal(check('浏览或移出时'), true)
  assert.equal(check('浏览历史'), false)
  assert.equal(check('abcdefghijkl'), false)
  assert.equal(check('abcdefghijklm'), true)
  assert.equal(findUiSurfaceGrammar('<UiSegmented options={[{value: "a", label: t("choice")}]} />').length, 0)
  assert.equal(findUiSurfaceGrammar('<UiOptionButton variant="segment" />').some(hit => hit.rule === 'S1'), true)
})

test('S 规则主表与真实消息键一致，S6 明确归 icons', () => {
  const skill = read('.codex/skills/henji-ui-surface/SKILL.md')
  const ids = [...skill.matchAll(/^\| S(\d+) \|/gm)].map(match => `S${match[1]}`).sort()
  assert.deepEqual(ids, [...Object.keys(MESSAGES), 'S6'].sort())
})

test('仅保留统一分段内部路径，移除 standalone API', () => {
  assert.doesNotMatch(read('src/components/ui/primitiveInternals.ts'), /segmentFrame/)
  assert.doesNotMatch(read('src/components/ui/primitives.tsx'), /segmentFrame|standalone/)
})

test('界面交付默认按风险；详细口径只维护在 skill', () => {
  const skill = read('.codex/skills/henji-ui-surface/SKILL.md')
  assert.doesNotMatch(skill, /交付时必须附受影响场景|默认验收 = 组件样张页/)
  assert.doesNotMatch(read('docs/rules/frontend-ui.md'), /## 用户界面信息准入|默认验收是/)
  assert.doesNotMatch(read('.codex/skills/henji-ui-surface/references/typography-and-tokens.md'), /L1 用|L2\/L3/)
})

test('ESLint 原生控件例外不放行颜色与 transition-all（含模板和变体）', async () => {
  const eslint = new ESLint()
  const check = async (filePath, text) => (await eslint.lintText(text, { filePath }))[0].messages.filter(message => message.ruleId === 'no-restricted-syntax')
  assert.equal((await check('src/components/Test.tsx', 'export const Example = () => <button/>')).length, 1)
  assert.equal((await check('src/components/ui/primitives.tsx', 'export const Example = () => <button/>')).length, 0)
  assert.equal((await check('src/components/ui/primitives.tsx', 'export const Example = () => <button className="bg-[#123456]"/>')).length > 0, true)
  for (const text of ['"transition-all"', '`hover:transition-all`', '"transition-all duration-120"']) {
    assert.equal((await check('src/components/Test.tsx', `export const Example = () => <div className={${text}}/>`)).length, 1)
  }
})

test('交互图形与范围填充统一至少 3:1', () => {
  assert.equal(requiredContrast({ kind: 'graphic' }), 3)
  assert.equal(require('./uiInspectionSceneGenerationVideoViewer.cjs').SELECTION_MIN_CONTRAST, 3)
})
