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
  { pattern: /RetryableHostCommandError|HostCommandError/, label: '旧命令错误命名' },
  { pattern: /\bagentCanvas[A-Za-z0-9_]*/, label: '助手专用画布业务入口' },
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
const protectedExecutionRoots = [
  'src/core/application-control',
  'src/core/assistant',
  'src/features/assistant/applicationCapabilities',
  'electron/main/services/agent-runtime',
]
const protectedExecutionForbidden = [
  { pattern: /\beval\s*\(/, label: '任意 eval 执行' },
  { pattern: /\bnew\s+Function\s*\(/, label: '任意 Function 执行' },
  { pattern: /\bexecuteScript\s*:/, label: '任意脚本能力' },
  { pattern: /\b(?:use[A-Za-z0-9]+Store|store)\.setState\s*\(/, label: '能力层直接 Store Patch' },
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
  'load_assistant_skill',
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

function relativeFiles(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(prefix, entry.name)
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) return relativeFiles(absolute, relative)
    return [relative]
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

for (const protectedRoot of protectedExecutionRoots) {
  for (const file of walk(path.join(root, protectedRoot))) {
    if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue
    const source = fs.readFileSync(file, 'utf8')
    const relative = path.relative(root, file).replaceAll('\\', '/')
    for (const rule of protectedExecutionForbidden) {
      if (rule.pattern.test(source)) failures.push(`${rule.label}：${relative}`)
    }
  }
}

for (const file of walk(path.join(root, 'src', 'core', 'application-control'))) {
  if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue
  const source = fs.readFileSync(file, 'utf8')
  const relative = path.relative(root, file).replaceAll('\\', '/')
  if (/from\s+['"]@\/(?:components|stores|features\/assistant)\//.test(source)) {
    failures.push(`Application API 核心跨层导入：${relative}`)
  }
}

// 双端 skill 同步：AGENTS.md 要求 .codex 与 .claude 两份内容一致，
// 因此这里检查全部共享 skill，而不只是应用能力那一份（历史上 henji-ui-surface
// 就出现过只更新 Codex 侧的漂移）。`agents/` 是 Codex 专属配置，不参与比较；
// 行尾差异不算内容不同步。
const codexSkillRoot = path.join(root, '.codex', 'skills')
const claudeSkillRoot = path.join(root, '.claude', 'skills')
const codexSkillNames = fs.readdirSync(codexSkillRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
const claudeSkillNames = fs.readdirSync(claudeSkillRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
if (JSON.stringify(codexSkillNames) !== JSON.stringify(claudeSkillNames)) {
  failures.push('Codex/Claude 技能目录不同步')
}
function normalizedSkillText(file) {
  return fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n')
}
for (const skillName of codexSkillNames.filter((name) => claudeSkillNames.includes(name))) {
  const skillRoots = [path.join(codexSkillRoot, skillName), path.join(claudeSkillRoot, skillName)]
  const skillFiles = skillRoots.map((directory) => relativeFiles(directory)
    .filter((file) => file === 'SKILL.md' || file.startsWith('references/'))
    .sort())
  if (JSON.stringify(skillFiles[0]) !== JSON.stringify(skillFiles[1])) {
    failures.push(`Codex/Claude 技能文件列表不同步：${skillName}`)
    continue
  }
  for (const relative of skillFiles[0]) {
    if (normalizedSkillText(path.join(skillRoots[0], relative)) !== normalizedSkillText(path.join(skillRoots[1], relative))) {
      failures.push(`Codex/Claude 技能内容不同步：${skillName}/${relative}`)
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
  path.join(root, 'src', 'features', 'navigation', 'application', 'surfaceCatalog.ts'),
  'utf8'
)
for (const field of [
  'observationCapabilityId', 'observationProviderId', 'observationPolicy', 'captureScope',
  'dataClass', 'maskPolicyId', 'supportedModalities', 'maxEdge', 'invalidWhen',
]) {
  if (!surfaceRegistrySource.includes(field)) failures.push(`Surface 观察契约缺少字段：${field}`)
}
const settingsSectionBlock = settingsNavigationSource
  .split('export const SETTINGS_SECTION_IDS = [')[1]
  ?.split(']')[0] ?? ''
const settingsSectionIds = [...settingsSectionBlock.matchAll(/'([^']+)'/g)].map((match) => match[1])
if (settingsSectionIds.length === 0) failures.push('未能解析设置分区清单 SETTINGS_SECTION_IDS')
for (const sectionId of settingsSectionIds) {
  if (!surfaceRegistrySource.includes(`sectionId: '${sectionId}'`)) {
    failures.push(`设置分区缺少 Surface：${sectionId}`)
  }
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
for (const scriptName of ['build', 'electron:build']) {
  if (!packageJson.scripts?.[scriptName]?.includes('check:assistant-capabilities')) {
    failures.push(`${scriptName} 未接入智能助手能力门禁`)
  }
}
const ciSource = fs.readFileSync(path.join(root, '.github', 'workflows', 'build.yml'), 'utf8')
if (!ciSource.includes('npm run check:assistant-capabilities')) {
  failures.push('CI 未显式运行智能助手能力门禁')
}

if (failures.length > 0) {
  console.error('智能助手应用能力覆盖检查失败：')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('智能助手应用能力覆盖检查通过：原生能力、Application API 边界、Surface 观察与双端技能同步。')
