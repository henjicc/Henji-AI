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
  {
    pattern: /PLAYBACK_NOT_READY|ANIMATABLE_WRITE_REQUIRES_PRO_MODE|KEYFRAME_REQUIRES_PRO_MODE|SHOT_REQUIRES_SIMPLE_MODE|assertProModeForKeyframes|assertSimpleModeForShots/,
    label: '已迁移到动态 availability 的领域手写守卫',
  },
  {
    pattern: /StageEditorMode|bakeToProMode|bake_camera_stage_to_pro|camera_stage\.shot|camera_stage\.keyframe|LEGACY_PRO_PROJECT_UNSUPPORTED|LegacyProfessionalProjectUnsupported/,
    label: 'Camera Stage 已删除的双模式或公开属性轨道契约',
  },
  {
    pattern: /\beditorMode\b/,
    label: 'Camera Stage 当前运行态重新出现编辑模式',
  },
  {
    pattern: /from\s+['"][^'"]*timeline\/TimelinePanel['"]|mode\s*:\s*z\.enum\(\[['"]simple['"],\s*['"]pro['"]\]\)/,
    label: 'Camera Stage 专业时间轴入口或模式选择器',
  },
  {
    pattern: /data\.applicationEffect|applicationEffect\s*:/,
    label: '用 evidence 文本代替强类型 Effect Receipt',
  },
  {
    pattern: /execute_application_program|run_camera_stage_state_animation_program|run_canvas_image_pipeline_program|run_application_settings_program|DeterministicWorkflowService|PROGRAM_RECIPE_AVAILABLE/,
    label: '重新引入 Henji Script 之外的第二套编排内核',
  },
  {
    pattern: /\bproducedRefs\b/,
    label: '旧 producedRefs 副作用推断契约',
  },
  {
    pattern: /plan_application_settings_change|apply_application_settings_change/,
    label: '设置写入重新出现专用计划或应用能力（应走通用反射事务）',
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
  'src/features/cameraStage/store/keyframeSlice.ts',
  'src/features/cameraStage/store/animationActions.ts',
  'src/features/cameraStage/timeline/TimelinePanel.tsx',
  'src/features/cameraStage/timeline/TimelineTrackList.tsx',
  'src/features/cameraStage/timeline/EasingCurveEditor.tsx',
  'src/features/cameraStage/application/cameraStageKeyframeService.ts',
  'src/features/cameraStage/application/cameraStageKeyframeCollectionExecutor.ts',
  'src/core/assistant/capabilities/applicationProgramApplicationCapabilities.ts',
  'electron/main/services/application-control/programs/service.ts',
  'electron/main/services/agent-runtime/programs/tools.ts',
  'src/core/assistant/capabilities/workflowApplicationCapabilities.ts',
  'electron/main/services/application-control/workflows/service.ts',
  'electron/main/services/agent-runtime/workflows/tools.ts',
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

for (const file of walk(path.join(root, 'src', 'core', 'assistant', 'capabilities'))) {
  if (file.endsWith('.test.ts')) continue
  const relative = path.relative(root, file).replaceAll('\\', '/')
  const source = fs.readFileSync(file, 'utf8')
  if (/\b(?:source|script|executeScript)\s*:\s*z\./.test(source)
    && relative !== 'src/core/assistant/capabilities/henjiScriptApplicationCapabilities.ts') {
    failures.push(`非 run_henji_script 能力暴露任意脚本字段：${relative}`)
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

/*
 * 领域级清点：**每个 feature 要么对助手可见，要么在这张表里写明原因。**
 *
 * 没有这条时，「imageMark 全域没接助手」和「imageMark 有意不接」在机器看来完全一样，只能靠人
 * 记住——而这正是本项目已经吃过的亏：三维场景外观 24 项界面能改、助手一项看不到，
 * 靠用户实测才发现。
 *
 * 这张表是一份**会缩短的清单**，不是一张会被遗忘的豁免表。清空它就是"助手能做的事等于人
 * 能做的事"的量化终点。条目要说清楚拦路的是什么、归到哪一期。
 */
const ASSISTANT_BLIND_FEATURES = {
  logs: '日志面板是独立窗口里的内存环形缓冲，只有暂停与清空两个动作，且不进任何持久化状态；'
    + '助手读日志走 query_diagnostic_events 直接查持久化事件，比读面板更全也更准。',
  navigation: 'Surface 目录本身就是助手的导航契约，通过 open/close_application_surface 与 '
    + 'get_current_application_context 覆盖，不再另建实体。',
  project: '工程管理界面操作的数据由 canvas.project 与 camera_stage.project 两个领域各自注册，'
    + '这一层只是它们的共用 UI 外壳。',
  assistant: '助手自身的运行时状态由 assistant.run / assistant.artifact 注册并写明 writeExclusion；'
    + '让助手改写自己的运行状态会破坏结算与证据链。',
  settings: '设置项的实体与属性注册在 application-control 子目录下，由 settingsReflection 覆盖；'
    + '这一层没有独立 store。',
  onboarding: '首次引导是可跳过、可回退的界面编排状态，不是独立业务实体；主供应商已通过 '
    + 'settings.registry 的 general.primary_provider 正式属性覆盖，设置分区已登记 Surface。'
    + 'API 密钥继续走受保护的 security.provider_keys，步骤进度与提示显隐属于 view_state，'
    + '不为助手另建专用能力或伪造 StoreLedger。',
  toolbox: '工具目录由工具箱注册表定义，属于应用结构而非用户数据，已有 toolbox.tool 的 writeExclusion。',
  maskEditor: '蒙版编辑器只管理本次面板内的位图绘制与未确认草稿，没有独立持久化实体或 zustand store；'
    + '确认后的蒙版引用和编辑文档由画布节点与派生媒体服务持有，入口由画布专用编辑器会话统一编排。'
    + '助手可读写最终画布节点，但不伪造逐像素鼠标绘制能力。',
}
for (const feature of fs.readdirSync(path.join(root, 'src', 'features'), { withFileTypes: true })) {
  if (!feature.isDirectory()) continue
  const featureRoot = path.join(root, 'src', 'features', feature.name)
  const files = walk(featureRoot).map((file) => path.basename(file))
  const hasReflection = files.some((name) => name.endsWith('Reflection.ts') && !name.endsWith('.test.ts'))
  const hasLedger = files.some((name) => name.endsWith('StoreLedger.ts'))
  if (hasReflection && hasLedger) continue
  const excuse = ASSISTANT_BLIND_FEATURES[feature.name]
  if (excuse && excuse.length > 20) continue
  const missing = [!hasReflection && 'Reflection', !hasLedger && 'StoreLedger'].filter(Boolean).join(' 与 ')
  failures.push(`领域对助手不可见且未登记原因：src/features/${feature.name}（缺 ${missing}）`)
}

/*
 * store 级清点：**每个 zustand store 要么有账本，要么在这张表里写明原因。**
 *
 * 上面的领域级检查只按 src/features 下的一级子目录遍历，画布账本能被发现纯属侥幸——
 * `canvasStoreLedger.ts` 恰好也放在 `src/features/canvas/` 下，与 `canvasStore.ts`
 * 实际放在 `src/stores/` 无关。这道检查按**内容**识别 store 文件（导入 zustand 且调用
 * `create<...>(`），不按目录约定——目录约定本身就是上一次盲区的成因：4.1 复核时发现
 * `src/services/largeUploadPolicy.ts` 里也藏着一个 store（`useLargeUploadPromptStore`），
 * 既不在 src/stores 下也不在任何 feature 的 store 子目录下，任何基于目录 glob 的扫描都会漏掉它。
 *
 * store ↔ 账本的对应关系：账本 `storeId` 必须等于 store 文件的 basename（去掉扩展名）。
 */
function isZustandStoreFile(source) {
  return /from\s+['"]zustand['"]/.test(source) && /=\s*create[<(]/.test(source)
}
const ASSISTANT_BLIND_STORES = {}
const ledgerStoreIds = new Set()
for (const file of walk(path.join(root, 'src'))) {
  if (!path.basename(file).endsWith('StoreLedger.ts')) continue
  const match = fs.readFileSync(file, 'utf8').match(/storeId:\s*'([^']+)'/)
  if (match) ledgerStoreIds.add(match[1])
}
for (const file of walk(path.join(root, 'src'))) {
  if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue
  const source = fs.readFileSync(file, 'utf8')
  if (!isZustandStoreFile(source)) continue
  const relative = path.relative(root, file).replaceAll('\\', '/')
  const storeId = path.basename(file, path.extname(file))
  if (ledgerStoreIds.has(storeId)) continue
  const excuse = ASSISTANT_BLIND_STORES[relative]
  if (excuse && excuse.length > 20) continue
  failures.push(`store 未建账且未登记原因：${relative}`)
}

/*
 * 属性写入执行器必须表驱动，不许回到手写 if-else 属性链。
 *
 * 手写链条对覆盖门禁是不透明的——它无法枚举「这个执行器到底能写哪些属性」，于是
 * 某实体属性声明可写、链条里没有对应分支这件事，实体级门禁可能长期全绿。
 * 表驱动之后 propertyCoverage 门禁能直接读出 key 集合与反射层声明双向比对，这条静态规则
 * 防的就是有人把某个执行器改回链式写法，把那道门禁重新变瞎。
 */
for (const file of walk(path.join(root, 'src', 'features'))) {
  const relative = path.relative(root, file).replaceAll('\\', '/')
  if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue
  if (!/\/application(?:-control)?\/.*(?:MutationExecutor|ControlExecutors)\.ts$/.test(relative)) continue
  const source = fs.readFileSync(file, 'utf8')
  if (/else\s+if\s*\(\s*(?:suffix|mutation\.propertyId)\s*===/.test(source)) {
    failures.push(`属性写入执行器手写 if-else 属性链（应改用 ApplicationPropertyWriterTable）：${relative}`)
  }
}

/*
 * 新增可写属性必须走统一字段定义（1.3），不许绕回「四处分别登记」的旧路。
 *
 * 这条钉住其中一处——写入表。字面量 `ApplicationPropertyWriterTable<...> = { 'a.b': {...} }`
 * 只应该出现在 `<领域>Fields.ts` 里，由 `fieldWriterTable()` 派生后导出给执行器消费；
 * 出现在别的文件里说明有人绕开统一定义，手写了一张新的登记表——四处登记的老问题会原样重演。
 * 真正的聚合点（如 cameraStageControlExecutors.ts 把多个 Fields 的写入表汇总成一张
 * entityType→table 的路由表）用的是已导入的常量，不含新的属性 id 字符串字面量，不会被这条误伤。
 */
for (const file of walk(path.join(root, 'src', 'features'))) {
  const relative = path.relative(root, file).replaceAll('\\', '/')
  if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue
  if (path.basename(file).endsWith('Fields.ts')) continue
  const source = fs.readFileSync(file, 'utf8')
  if (/ApplicationPropertyWriterTable<[^>]*>\s*=\s*\{/.test(source)) {
    failures.push(`可写属性写入表脱离统一字段定义，手写在了 *Fields.ts 之外（应改用 ApplicationFieldDefinition + fieldWriterTable）：${relative}`)
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
