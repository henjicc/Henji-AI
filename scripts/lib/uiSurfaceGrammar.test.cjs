/* eslint-disable @typescript-eslint/no-var-requires -- Node 内置测试运行器加载 CommonJS 门禁。 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { findUiSurfaceGrammar } = require('./uiSurfaceGrammar.cjs')

const fixtures = [
  ['S1', '<div><UiOptionButton variant="segment"/><UiOptionButton variant="segment"/></div>', '<UiSegmented options={options} />'],
  ['S2', '<UiGroup><Dropdown /></UiGroup>', '<UiGroup><UiFormRow label="方式"><Dropdown /></UiFormRow></UiGroup>'],
  ['S3', '<div className="flex gap-2"><Dropdown label="方式"/><Dropdown label="属性"/></div>', '<div className="flex flex-col"><Dropdown label="方式"/><Dropdown label="属性"/></div>'],
  ['S4', '<div>{items.map(item => <div><h3>{item.title}</h3><p className="text-text2">{item.meta}</p></div>)}</div>', '<div>{items.map(item => <div className="border-b border-line"><h3>{item.title}</h3><p className="text-text2">{item.meta}</p></div>)}</div>'],
  ['S5', '<div><UiFormRow labelWidth={72} label="方式"/><UiFormRow labelWidth={96} label="属性"/></div>', '<UiGroup labelWidth={96}><UiFormRow label="方式"/><UiFormRow label="属性"/></UiGroup>'],
]
test('S1 分段最多五项，更多项改下拉；动态项数交给共享组件处理', () => {
  assert.equal(findUiSurfaceGrammar('<UiSegmented options={[1,2,3,4,5]} />').length, 0)
  assert.equal(findUiSurfaceGrammar('<SettingsSegmented options={[1,2,3,4,5,6]} />')[0].rule, 'S1')
  assert.equal(findUiSurfaceGrammar('<Dropdown options={[1,2,3,4,5,6]} />').length, 0)
})
for (const [rule, bad, good] of fixtures) test(`${rule}: 正反夹具与行级豁免`, () => {
  const hits = findUiSurfaceGrammar(bad)
  assert.equal(hits.filter(hit => hit.rule === rule).length, 1)
  assert.equal(hits[0].severity, rule === 'S4' ? 'warning' : 'error')
  assert.equal(findUiSurfaceGrammar(good).length, 0)
  assert.equal(findUiSurfaceGrammar(`// ui-surface-allow: ${rule} 夹具中有意演示反例\n${bad}`).length, 0)
  assert.equal(findUiSurfaceGrammar(`// ui-surface-allow: ${rule}\n${bad}`).length, 1)
})

test('S5 列宽：继承、默认、别名、常量与不可静态判定的边界', () => {
  const hits = source => findUiSurfaceGrammar(source).filter(hit => hit.rule === 'S5')
  assert.equal(hits('<div><UiFormRow labelColumn="panel"/><UiFormRow labelWidth={72}/></div>').length, 0)
  assert.equal(hits('<div><UiFormRow labelColumn="panel"/><UiFormRow labelWidth={96}/></div>').length, 1)
  assert.equal(hits('<UiGroup labelWidth={96}><UiFormRow/><UiGroup><UiFormRow labelColumn="panel"/></UiGroup><UiFormRow labelColumn="auto"/></UiGroup>').length, 0)
  assert.equal(hits('<UiGroup labelWidth={96}><UiFormRow/><UiGroup labelWidth={120}><UiFormRow/></UiGroup></UiGroup>').length, 1)
  assert.equal(hits('import { UiFormRow as Row } from "ui"; const WIDTH = 96; <><Row labelWidth={WIDTH}/><Row labelWidth={120}/></>').length, 1)
  assert.equal(hits('<UiGroup labelWidth={unknown}><UiFormRow labelColumn="panel"/><UiFormRow labelWidth={96}/></UiGroup>').length, 0)
  assert.equal(hits('<UiToolbar><UiFormRow labelWidth={72}/></UiToolbar><UiGroup labelWidth={96}><UiFormRow/></UiGroup>').length, 0)
  assert.equal(hits('<><UiFormRow {...props}/><UiFormRow labelWidth={96}/></>').length, 0)
})
test('结构边界：map、别名、工具栏与 JSX 注释', () => {
  assert.equal(findUiSurfaceGrammar('import { UiOptionButton as Option } from "ui"; <div>{xs.map(x => <Option variant={"segment"}/>)}</div>')[0].rule, 'S1')
  assert.equal(findUiSurfaceGrammar('<UiToolbar><UiGroup><Dropdown /></UiGroup></UiToolbar>').length, 0)
  assert.equal(findUiSurfaceGrammar('<UiFieldLayoutContext.Provider value="toolbar"><UiGroup><Dropdown /></UiGroup></UiFieldLayoutContext.Provider>').length, 0)
  assert.equal(findUiSurfaceGrammar('<UiGroup>{/* ui-surface-allow: S2 已由宿主提供标签 */}\n<Dropdown /></UiGroup>').length, 0)
  assert.equal(findUiSurfaceGrammar('<div><UiOptionButton variant="segment"/><span>分开</span><UiOptionButton variant="segment"/></div>').length, 0)
  assert.equal(findUiSurfaceGrammar('<div>{flag ? <UiOptionButton variant="segment"/> : <UiOptionButton variant="segment"/>}</div>').length, 0)
  assert.equal(findUiSurfaceGrammar('<UiGroup title="// ui-surface-allow: S2 不是注释"><Dropdown /></UiGroup>').length, 1)
  assert.equal(findUiSurfaceGrammar('<UiGroup className={`flex ${value}`} >{/* ui-surface-allow: S2 已由宿主提供标签 */}\n<Dropdown /></UiGroup>').length, 0)
  assert.equal(findUiSurfaceGrammar('<UiGroup>// ui-surface-allow: S2 只是文本\n<Dropdown /></UiGroup>').length, 1)
})
