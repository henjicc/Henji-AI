const { test } = require('node:test')
const assert = require('node:assert/strict')
const { validateFindings, checkUiFindings } = require('../check-ui-findings.cjs')
const guards = { sceneIds: new Set(['generation-empty']), ruleKeys: new Set(['lowContrast']) }
const entry = { id: 'K06', source: 'u7', status: 'closed', fixedIn: '66271df46', owner: '5.3', conclusion: '规则已补', evidence: '空态断言已登记', guard: ['scene:generation-empty'] }

test('关闭项不能无 guard、借用不存在 guard 或省略修复提交', () => {
  assert.deepEqual(validateFindings([entry], guards), [])
  for (const broken of [{ guard: [] }, { guard: ['scene:deleted'] }, { guard: ['rule:unknown'] }, { fixedIn: null }, { id: null }]) assert.ok(validateFindings([{ ...entry, ...broken }], guards).length > 0)
  assert.ok(validateFindings([entry, entry], guards).length > 0)
  assert.ok(validateFindings([{ ...entry, status: 'pending-verification', nextStep: undefined }], guards).length > 0)
})

test('u7 与 5.8 遗留全部登记，guard 来自真实注册表', () => {
  assert.deepEqual(checkUiFindings(), [])
  const ids = require('../ui-review/findings.json').map(entry => entry.id)
  for (const id of ['u7-K03', 'u7-K06', 'u7-K08', 'u7-K09', '5.8-window-size', '5.8-video-edit-960', '5.8-heavy-scenes', '5.8-ruler-corner', '5.8-llm-eperm']) assert.ok(ids.includes(id), id)
})
