const fs = require('node:fs')
const path = require('node:path')
const { exportedComponents, catalogProblems } = require('./lib/uiDocumentation.cjs')
function checkUiCatalog(root = process.cwd()) {
  const names = exportedComponents(path.join(root, 'src/components/ui/index.ts'))
  return catalogProblems(names, fs.readFileSync(path.join(root, '.codex/skills/henji-ui-surface/SKILL.md'), 'utf8'))
}
if (require.main === module) {
  const problems = checkUiCatalog()
  if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1 }
  else console.log('[check-ui-catalog] UI 公共导出全部登记在 skill 复用表')
}
module.exports = { checkUiCatalog }
