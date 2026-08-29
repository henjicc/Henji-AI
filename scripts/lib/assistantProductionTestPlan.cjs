const path = require('node:path')

const VITEST_SCRIPT_NAMES = Object.freeze([
  'test:assistant-model-compat',
  'test:assistant-eval',
  'test:assistant-settlement',
])

function extractVitestTargets(scriptName, script) {
  const tokens = script.trim().split(/\s+/)
  if (tokens[0] !== 'vitest' || tokens[1] !== 'run') {
    throw new Error(`${scriptName} 不再是可合并的 vitest run 命令`)
  }
  const targets = tokens.slice(2)
  if (targets.length === 0 || targets.some((token) => !/\.test\.[jt]sx?$/.test(token))) {
    throw new Error(`${scriptName} 包含非测试文件参数，需显式更新生产测试聚合器`)
  }
  return targets
}

function buildAssistantProductionTestPlan(packageJson, root) {
  const targets = [...new Set(VITEST_SCRIPT_NAMES.flatMap((scriptName) => (
    extractVitestTargets(scriptName, packageJson.scripts?.[scriptName] ?? '')
  )))]
  return [
    {
      label: `助手生产 Vitest（去重后 ${targets.length} 文件）`,
      command: process.execPath,
      args: [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', ...targets],
    },
    {
      label: '助手持久化进程验收',
      command: process.execPath,
      args: [path.join(root, 'scripts/test-assistant-persistence.cjs')],
    },
  ]
}

module.exports = {
  VITEST_SCRIPT_NAMES,
  buildAssistantProductionTestPlan,
  extractVitestTargets,
}
