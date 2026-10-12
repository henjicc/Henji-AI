const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { suites, checkNodeTestOwnership } = require('./lib/nodeTestSuites.cjs')
try {
  const root = path.resolve(__dirname, '..')
  const count = checkNodeTestOwnership(root)
  const suite = process.argv[2]
  if (suite === '--check') process.stdout.write(`Node 测试归属通过：${count} 文件\n`)
  else {
    if (!suites[suite]?.length) throw new Error('请指定已登记 Node 测试层：fast/native 或 --check')
    const result = spawnSync(process.execPath, ['--test', ...suites[suite]], { cwd: root, stdio: 'inherit', windowsHide: true })
    if (result.error) throw result.error
    process.exitCode = result.signal ? 1 : result.status ?? 1
  }
} catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1 }
