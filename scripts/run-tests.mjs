import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCLI } from 'vitest/node'
import suites from './lib/testSuites.cjs'
import native from './test-assistant-persistence.cjs'

const root = fileURLToPath(new URL('../', import.meta.url))

export function createTestRunPlan(args) {
  const { filter, options } = parseCLI(['vitest', 'run', ...args])
  const filters = filter.map(value => (path.isAbsolute(value) ? path.relative(root, value) : value).replaceAll('\\', '/').replace(/^\.\//, ''))
  const nativeFiles = options.help || options.version || options.mode && !['test', 'native'].includes(options.mode) ? [] : suites.NATIVE_TEST_FILES.filter(file => !filters.length || filters.some(value => file.toLocaleLowerCase().includes(value.toLocaleLowerCase())))
  const unsupported = Object.keys(options).filter(key => !['--', 'color', 'run', 'maxWorkers', 'minWorkers', 'silent', 'mode'].includes(key))
  if (nativeFiles.length && unsupported.length) throw new Error(`原生 SQLite 验收必须整文件执行，不支持这些 Vitest 选项：${unsupported.join('、')}。普通测试筛选请使用 npm run test:unit；原生文件请使用 npm run test:assistant-persistence -- <文件>。`)
  const onlyNative = nativeFiles.length > 0 && (options.mode === 'native' || filters.length > 0 && filters.every(value => suites.NATIVE_TEST_FILES.some(file => file.toLocaleLowerCase() === value.toLocaleLowerCase())))
  return { vitestArgs: onlyNative ? null : ['run', ...args, ...(filters.length && nativeFiles.length ? ['--passWithNoTests'] : [])], nativeFiles }
}

async function run(args) {
  const plan = createTestRunPlan(args)
  if (plan.vitestArgs) {
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(root, 'node_modules/vitest/vitest.mjs'), ...plan.vitestArgs], { cwd: root, stdio: 'inherit', windowsHide: true })
      child.once('error', reject)
      child.once('close', code => resolve(code ?? 1))
    })
    if (code !== 0) { process.exitCode = code; return }
  }
  if (plan.nativeFiles.length) {
    const result = await native.runNativePersistence({ testFiles: plan.nativeFiles })
    console.log(`Electron 原生 SQLite 验证通过：${result.files} 文件，${result.passed} 用例，0 跳过`)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1 })
}
