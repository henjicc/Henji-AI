const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const sourceRoots = ['src', 'electron']
const sourceExtensions = new Set(['.ts', '.tsx'])
const forbidden = [
  { pattern: /kind:\s*['"]command['"]/, label: '旧式 command operation' },
  { pattern: /kind:\s*['"]query['"]/, label: '旧式 query operation' },
  { pattern: /createCompatibilityCapabilityDescriptor/, label: '能力兼容描述生成器' },
  { pattern: /hostCommandRegistry|hostQueryRegistry/, label: '固定宿主执行表' },
  { pattern: /HostCommandResult|hostCommandResultSchema/, label: '旧命令结果契约' },
  {
    pattern: /COMMAND_NOT_READY|COMMAND_REJECTED|UNKNOWN_COMMAND/,
    label: '旧命令错误码',
  },
  {
    pattern: /availableCommands|availableQueries/,
    label: 'v2 快照中的旧工具目录',
    allow: ['src/core/assistant/hostContracts.ts'],
  },
]
const obsoleteFiles = [
  'src/features/assistant/frontendTools/hostCommandRegistry.ts',
  'src/features/assistant/frontendTools/hostQueryRegistry.ts',
  'electron/main/services/agent-runtime/tools/builtin/frontend.ts',
  'electron/main/services/agent-runtime/tools/builtin/frontend-assets.ts',
  'electron/main/services/agent-runtime/tools/builtin/frontend-canvas.ts',
  'electron/main/services/agent-runtime/tools/builtin/frontend-canvas-projects.ts',
  'electron/main/services/agent-runtime/tools/builtin/frontend-canvas-mutations.ts',
  'electron/main/services/agent-runtime/tools/builtin/frontend-canvas-batch.ts',
  'electron/main/services/agent-runtime/tools/builtin/frontend-toolbox.ts',
]
const migratedBackendCapabilityIds = [
  'read_agent_artifact',
  'query_diagnostic_events',
  'list_agent_memories',
  'propose_agent_memory',
  'confirm_agent_memory',
  'reject_agent_memory',
  'get_user_instructions',
  'update_user_instructions',
  'list_workflows',
  'plan_workflow',
  'execute_workflow',
  'get_workflow_run',
  'pause_workflow',
  'resume_workflow',
  'cancel_workflow',
  'rollback_workflow',
]

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) return walk(absolute)
    return sourceExtensions.has(path.extname(entry.name)) ? [absolute] : []
  })
}

const failures = []
for (const relative of obsoleteFiles) {
  if (fs.existsSync(path.join(root, relative))) failures.push(`旧文件仍存在：${relative}`)
}

for (const sourceRoot of sourceRoots) {
  for (const file of walk(path.join(root, sourceRoot))) {
    if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue
    const source = fs.readFileSync(file, 'utf8')
    const relative = path.relative(root, file).replaceAll('\\', '/')
    for (const rule of forbidden) {
      if (rule.allow?.includes(relative)) continue
      if (rule.pattern.test(source)) {
        failures.push(`${rule.label}：${relative}`)
      }
    }
  }
}

const capabilitySources = walk(path.join(root, 'src', 'core', 'assistant'))
  .map((file) => fs.readFileSync(file, 'utf8'))
  .join('\n')
const backendRuntimeSources = walk(path.join(root, 'electron', 'main', 'services', 'agent-runtime'))
  .filter((file) => !file.endsWith('.test.ts'))
  .map((file) => fs.readFileSync(file, 'utf8'))
  .join('\n')
for (const id of migratedBackendCapabilityIds) {
  const definitionPattern = new RegExp(`['"]${id}['"]`)
  const oldToolPattern = new RegExp(`\\bname:\\s*['"]${id}['"]`)
  if (!definitionPattern.test(capabilitySources)) {
    failures.push(`后端能力缺少原生定义：${id}`)
  }
  if (oldToolPattern.test(backendRuntimeSources)) {
    failures.push(`后端能力仍在手写旧工具元数据：${id}`)
  }
}

const settingsNavigationSource = fs.readFileSync(
  path.join(root, 'src', 'core', 'types', 'settingsNavigation.ts'),
  'utf8'
)
const surfaceRegistrySource = fs.readFileSync(
  path.join(root, 'src', 'features', 'assistant', 'applicationCapabilities', 'surfaceRegistry.ts'),
  'utf8'
)
const settingsSectionBlock = settingsNavigationSource
  .split('export type SettingsSectionId =')[1]
  ?.split('/**')[0] ?? ''
const settingsSectionIds = [...settingsSectionBlock.matchAll(/\|\s*'([^']+)'/g)]
  .map((match) => match[1])
for (const sectionId of settingsSectionIds) {
  if (!surfaceRegistrySource.includes(`sectionId: '${sectionId}'`)) {
    failures.push(`设置分区缺少 Surface：${sectionId}`)
  }
}

if (failures.length > 0) {
  console.error('智能助手应用能力覆盖检查失败：')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('智能助手应用能力覆盖检查通过：生产代码仅使用原生 capability operation。')
