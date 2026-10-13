const fs = require('node:fs')
const path = require('node:path')
const { declaredSymbols, symbolProblems } = require('./lib/uiDocumentation.cjs')
function checkSkillSymbols(root = process.cwd()) {
  const dir = '.codex/skills/henji-ui-surface'
  const files = [`${dir}/SKILL.md`, ...fs.readdirSync(path.join(root, dir, 'references')).filter(name => name.endsWith('.md')).map(name => `${dir}/references/${name}`), 'docs/rules/frontend-ui.md']
  const symbols = declaredSymbols(path.join(root, 'src'))
  return files.flatMap(file => symbolProblems(fs.readFileSync(path.join(root, file), 'utf8'), symbols).map(problem => `${file}: ${problem}`))
}
if (require.main === module) {
  const problems = checkSkillSymbols()
  if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1 }
  else console.log('[check-skill-symbols] 界面规范中的精确符号均有源码声明')
}
module.exports = { checkSkillSymbols }
