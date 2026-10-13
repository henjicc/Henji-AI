const fs = require('node:fs')
const path = require('node:path')
const { UI_AUDIT_RULES } = require('./lib/uiAuditDom.cjs')
const { createUiInspectionScenes } = require('./lib/uiInspectionScenes.cjs')

function validateFindings(entries, { sceneIds, ruleKeys }) {
  const problems = []
  const ids = new Set()
  if (!Array.isArray(entries) || entries.length === 0) return ['巡检台账必须为非空数组']
  for (const entry of entries) {
    if (!entry.id || ids.has(entry.id)) problems.push(`台账 id 缺失或重复：${entry.id}`)
    ids.add(entry.id)
    if (!['u7', '5.8'].includes(entry.source) || !['closed', 'pending-verification', 'deferred'].includes(entry.status)) problems.push(`${entry.id} 来源或状态无效`)
    if (!entry.owner || !entry.conclusion || !entry.evidence) problems.push(`${entry.id} 缺责任人、结论或证据`)
    if (!Array.isArray(entry.guard) || !entry.guard.length) problems.push(`${entry.id} 缺 guard`)
    for (const guard of entry.guard || []) {
      const [kind, id] = guard.split(':')
      if (!(kind === 'scene' ? sceneIds.has(id) : kind === 'rule' ? ruleKeys.has(id) : false)) problems.push(`${entry.id} guard 不存在：${guard}`)
    }
    if (entry.status === 'closed' && !/^[0-9a-f]{7,40}$/.test(entry.fixedIn || '')) problems.push(`${entry.id} 已关闭但无修复提交`)
    if (entry.status !== 'closed' && !entry.nextStep) problems.push(`${entry.id} 未关闭但无下一步`)
  }
  return problems
}
function checkUiFindings(root = process.cwd()) {
  const entries = JSON.parse(fs.readFileSync(path.join(root, 'scripts/ui-review-findings.json'), 'utf8'))
  const scenes = createUiInspectionScenes({ canvasFixtureProjectId: '__catalog_only__', settlePage: async () => undefined })
  return validateFindings(entries, { sceneIds: new Set(scenes.map(scene => scene.id)), ruleKeys: new Set(UI_AUDIT_RULES.map(rule => rule.key)) })
}
if (require.main === module) {
  const problems = checkUiFindings()
  if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1 }
  else console.log('[check-ui-findings] 遗留去向与真实场景/规则 guard 完整')
}
module.exports = { validateFindings, checkUiFindings }
