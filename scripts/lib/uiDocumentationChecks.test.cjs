const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { exportedComponents, catalogProblems, symbolProblems } = require('./uiDocumentation.cjs')
const { generateTokenTable, checkTokenDocs } = require('../gen-token-docs.cjs')

test('目录核对跟随 export *、别名、函数/类/const；忽略 type 与正文碰巧提到', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-ui-catalog-'))
  try {
    fs.writeFileSync(path.join(dir, 'index.ts'), 'export * from "./child"; export { default as Dropdown, type UiProps } from "./child"')
    fs.writeFileSync(path.join(dir, 'child.ts'), 'export const UiButton = 1; export function UiPanel() {}\nexport class UiErrorBoundary {}\nexport interface UiProps {}')
    const names = exportedComponents(path.join(dir, 'index.ts'))
    assert.deepEqual([...names].sort(), ['Dropdown', 'UiButton', 'UiErrorBoundary', 'UiPanel'])
    assert.deepEqual(catalogProblems(names, '正文 UiButton\n## 必须复用 vs 允许新增\n| 用途 | `Dropdown` / `UiPanel` / `UiErrorBoundary` |\n## Agent 改 UI'), ['复用表未登记 UiButton'])
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('符号核对只识别精确反引号标识符；示例逐行显式豁免', () => {
  const symbols = new Set(['UiButton', 'UI_TEXT_BODY_CLASS', 'usePlaybackClock'])
  assert.equal(symbolProblems('`UiButton` / `UI_TEXT_BODY_CLASS` / `usePlaybackClock`', symbols).length, 0)
  assert.equal(symbolProblems('`UiDeleted` / `UI_UNKNOWN_CLASS` / `useDeleted`', symbols).length, 3)
  assert.equal(symbolProblems('`UiDeleted` <!-- symbol-ignore -->\n`Ui*` / `UI_TEXT_*`', symbols).length, 0)
})

test('令牌表必须从真实配置生成，缺失/漂移阻断', () => {
  const generated = generateTokenTable()
  assert.match(generated, /DEFAULT: 180ms/)
  assert.match(generated, /control: var\(--radius-control\)/)
  assert.deepEqual(checkTokenDocs(), [])
})
