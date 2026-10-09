const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const baselinePath = path.join(__dirname, 'dead-code-baseline.json')

function normalizeReport(report) {
  if (!report || !Array.isArray(report.issues)) throw new Error('Knip 未返回有效 issues 数组')
  const files = new Set()
  const dependencies = new Set()
  let exports = 0
  const diagnostics = []
  for (const issue of report.issues) {
    for (const item of issue.files || []) files.add(item.name.replaceAll('\\', '/'))
    for (const key of ['dependencies', 'devDependencies', 'optionalPeerDependencies']) {
      for (const item of issue[key] || []) dependencies.add(`${issue.file.replaceAll('\\', '/')}:${item.name}`)
    }
    exports += (issue.exports || []).length + (issue.types || []).length + (issue.namespaceMembers || []).length
    for (const key of ['unlisted', 'unresolved', 'binaries']) for (const item of issue[key] || []) diagnostics.push(`${key}: ${issue.file}: ${item.name}`)
  }
  return { files: [...files].sort(), dependencies: [...dependencies].sort(), exports, diagnostics }
}

function compareBaseline(current, baseline) {
  return ['files', 'dependencies'].flatMap(key => current[key].filter(item => !baseline[key].includes(item)).map(item => `新增未使用 ${key}: ${item}`))
}

function runKnip(root) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-knip-'))
  const output = path.join(temporary, 'report.json')
  const fd = fs.openSync(output, 'w')
  try {
    const bin = path.resolve(path.dirname(require.resolve('knip')), '../bin/knip.js')
    const result = spawnSync(process.execPath, [bin, '--reporter', 'json', '--no-progress', '--no-exit-code'], { cwd: root, stdio: ['ignore', fd, 'pipe'], encoding: 'utf8' })
    if (result.error || result.status !== 0) throw new Error(`Knip 执行失败: ${result.error?.message || result.stderr || result.status}`)
    return normalizeReport(JSON.parse(fs.readFileSync(output, 'utf8').replace(/^\uFEFF/, '')))
  } finally {
    fs.closeSync(fd)
    fs.rmSync(temporary, { recursive: true, force: true })
  }
}

function check(root, target, write = false) {
  const current = runKnip(root)
  if (!fs.existsSync(target)) throw new Error('死代码基线缺失；首次登记须显式使用 --initialize <理由>')
  const baseline = JSON.parse(fs.readFileSync(target, 'utf8'))
  if (baseline.version !== 1 || !Array.isArray(baseline.files) || !Array.isArray(baseline.dependencies)) throw new Error('死代码基线格式错误')
  const errors = compareBaseline(current, baseline)
  if (write && !errors.length) fs.writeFileSync(target, `${JSON.stringify({ ...baseline, files: current.files, dependencies: current.dependencies }, null, 2)}\n`)
  return { ...current, errors }
}

if (require.main === module) {
  try {
    const root = path.resolve(__dirname, '..')
    const initialize = process.argv.indexOf('--initialize')
    if (initialize !== -1) {
      const reason = process.argv[initialize + 1]?.trim()
      if (!reason || fs.existsSync(baselinePath)) throw new Error('首次登记须提供理由，且不得覆盖已有基线')
      const current = runKnip(root)
      fs.writeFileSync(baselinePath, `${JSON.stringify({ version: 1, reason, files: current.files, dependencies: current.dependencies }, null, 2)}\n`)
      console.log(`登记基线: ${current.files.length} 文件 / ${current.dependencies.length} 依赖`)
    } else {
      const result = check(root, baselinePath, process.argv.includes('--write'))
      console.log(`Knip: ${result.files.length} 存量未使用文件 / ${result.dependencies.length} 存量未使用依赖；${result.exports} 导出/类型仅报告`)
      for (const diagnostic of result.diagnostics) console.log(diagnostic)
      for (const error of result.errors) console.error(error)
      process.exitCode = result.errors.length ? 1 : 0
    }
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
module.exports = { normalizeReport, compareBaseline, runKnip, check }
