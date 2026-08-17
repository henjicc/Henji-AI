const { spawn, spawnSync } = require('node:child_process')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const runner = path.join(__dirname, 'run-assistant-cli.cjs')
const rawArgs = process.argv.slice(2)
const visible = rawArgs.includes('--visible')
const skipGeneration = rawArgs.includes('--skip-generation')
/** 只跑词汇探针：验模型认不认得各域的词，不跑完整业务链路。 */
const probeOnly = rawArgs.includes('--probe')
const onlyIndex = rawArgs.indexOf('--only')
const only = onlyIndex >= 0 ? rawArgs[onlyIndex + 1] : null
const timeoutIndex = rawArgs.indexOf('--timeout')
const timeoutMs = timeoutIndex >= 0 ? Number(rawArgs[timeoutIndex + 1]) : 20 * 60 * 1_000
const approvalIndex = rawArgs.indexOf('--approval')
const approvalMode = approvalIndex >= 0 ? rawArgs[approvalIndex + 1] : 'assistant_decides'
const activeChildren = new Set()

function terminateProcessTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true, stdio: 'ignore',
    })
  } else {
    child.kill('SIGTERM')
  }
}

function terminateAll() {
  for (const child of activeChildren) terminateProcessTree(child)
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    terminateAll()
    process.exitCode = 1
  })
}
process.once('exit', terminateAll)

if (!Number.isInteger(timeoutMs) || timeoutMs < 60_000 || timeoutMs > 60 * 60 * 1_000) {
  process.stderr.write('--timeout 必须是 60000 到 3600000 之间的整数毫秒数\n')
  process.exit(1)
}
if (!['ask', 'assistant_decides', 'full_access'].includes(approvalMode)) {
  process.stderr.write('--approval 仅支持 ask、assistant_decides 或 full_access\n')
  process.exit(1)
}

/**
 * 唯一名必须**足够独特才能安全反替换**。
 *
 * 原来用的是 14 位时间戳（`20260817111319`）。它有两个问题：一是纯数字，录制器要把它从
 * 整份 trace 里替换成占位符时可能误伤坐标、时长这些正常数值；二是它把"哪天跑的"焊进了
 * 场景语义，而那本该是与场景无关的一次性标识。
 *
 * 换成 `n` + 6 位 36 进制随机串：碰撞概率可忽略，字母开头且带前缀，整份文本里几乎不可能
 * 与业务值撞上。录制器 `--nonce` 收下它，把它换成 `{{nonce}}`；回放注入固定值。
 */
function createNonce() {
  return `n${Math.random().toString(36).slice(2, 8).padEnd(6, '0')}`
}
const nonce = createNonce()

/**
 * 场景按**交互模式**组织，不按领域。
 *
 * 运行时与领域无关：所有前端能力都走 `adaptCapability` 同一条路，Gateway、租约、revision
 * 都不看域。所以"A 域通、B 域不通"的差异只可能来自三处——注册数据（L-A 静态可查）、
 * 领域执行器（L-B 剧本可查）、模型对该域词汇的理解（只有真机能查）。前两类不该占用真机预算。
 *
 * `mode` 是这条场景真正在验的交互形状；`domain` 只是它借用的领域词汇。想覆盖新领域时优先
 * 用 `--probe` 加一条词汇探针，而不是复制一条完整场景——完整场景每条 3~8 分钟，探针只跑到
 * 第一段脚本提交为止。
 */
const scenarios = [
  {
    id: 'camera', mode: '建连查 + 时间轴写入', domain: 'camera_stage',
    goal: `新建一个名为“自动验收-${nonce}-三维”的 3D 工程，放入一个球体，`+
      '让它在 0、1、2 秒的 y 坐标分别为 0、1.5、0，开启循环并播放；最后从正式场景状态验证三枚状态关键帧和播放状态。',
  },
  {
    id: 'assets', mode: '增改删 + 逐步读回', domain: 'assets',
    goal: `创建名为“自动验收-${nonce}-素材库”的素材库，把它改名为“自动验收-${nonce}-已改名”，`+
      '从正式素材库列表确认新名称后删除它，并再次确认它已不存在。',
  },
  {
    id: 'canvas', mode: '建连查', domain: 'canvas',
    /*
     * 坐标必须写死。
     *
     * 原文是"移动到明确坐标"，却一个数都没给——场景自己自相矛盾。实测两个模型给出两种都
     * 正确的反应：Kimi 自己挑了一组坐标，mimo 调 ask_user 问用户要坐标然后停下等待。后者恰恰
     * 是提示词教它做的事（猜错代价高就问），但无人值守跑批里没人回答，场景就永远跑不完。
     *
     * 要测的是"能不能把节点移到指定位置"，那就把位置指定出来；想测歧义处理另开场景。
     */
    goal: `新建名为“自动验收-${nonce}-画布”的画布工程，创建一个文本提示词节点和一个图片节点，`+
      '把文本节点移动到坐标 x=420、y=280 并连接到图片节点；最后读取正式画布图结构验证节点、位置和连线。',
  },
  {
    id: 'settings', mode: '读改验 + 同事务恢复', domain: 'settings',
    goal: '先读取 general.language 与 interface.theme_tone 的当前真实值；用一次 Henji Script 修改并读回验证，随后仍在同一脚本中恢复原值并再次读回验证。',
  },
  {
    id: 'generation', external: true, mode: '外部等待续跑', domain: 'generation',
    goal: `生成一张“暖色极简几何山谷、无文字”的图片，并创建名为“自动验收-${nonce}-生成画布”的画布工程；`+
      '等待生成权威成功状态后，把真实 generation.result 放入画布，最后读取正式画布确认媒体节点存在。',
  },
  /*
   * 词汇探针：只验"模型认不认得这个域的词"，不验整条业务链路。
   *
   * 只有 `--probe` 时才启用。领域词汇是真机唯一不可替代的那一格，但它在**第一段脚本**就已经
   * 暴露——模型要么发现得到该域能力并写出合法调用，要么撞 ENTITY_TYPE_NOT_FOUND 或干脆
   * 宣称应用没有这个能力。跑完整场景只是在已知答案后面多烧几分钟。
   */
  {
    id: 'probe-image-edit', probeOnly: true, mode: '词汇探针', domain: 'image_edit',
    goal: '列出图片编辑器当前可用的编辑能力，并说明其中哪一条能对素材做不覆盖原图的旋转预览；只读，不要执行任何修改。',
  },
  {
    id: 'probe-storyboard', probeOnly: true, mode: '词汇探针', domain: 'storyboard',
    goal: '列出已有的分镜项目，并说明分镜项目里可以读到哪些结构信息；只读，不要改动任何内容。',
  },
  {
    id: 'probe-toolbox', probeOnly: true, mode: '词汇探针', domain: 'toolbox',
    goal: '列出工具箱里当前可用的工具，并说明它们各自属于哪个工作区；只读，不要打开或切换任何界面。',
  },
].filter((scenario) => (
  (probeOnly ? scenario.probeOnly === true : scenario.probeOnly !== true)
  && (!skipGeneration || !scenario.external)
  && (!only || scenario.id === only)
))

if (scenarios.length === 0) {
  process.stderr.write(`没有匹配的场景：${only ?? '(空)'}\n`)
  process.exit(1)
}

function runScenario(scenario) {
  return new Promise((resolve) => {
    const args = [runner, '--goal', scenario.goal, '--trace', 'detailed',
      '--approval', approvalMode, '--timeout', String(timeoutMs)]
    /*
     * 探针是只读的，不能要求已验证写入。
     *
     * 这条标志让 CLI 在没有写入 Effect 时以退出码 1 结束——对完整场景是正确的验收，对词汇
     * 探针则是必然失败：它问的是"模型认不认得这个域的词"，本来就不该产生任何写入。
     */
    if (!scenario.probeOnly) args.push('--require-verified-write')
    if (scenario.external) args.push('--await-generation')
    if (visible) args.push('--visible')
    const child = spawn(process.execPath, args, {
      cwd: projectRoot, env: { ...process.env }, windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    activeChildren.add(child)
    const hardTimeout = setTimeout(() => terminateProcessTree(child), timeoutMs + 30_000)
    const records = []
    let stdoutBuffer = ''
    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString('utf8')
      const lines = stdoutBuffer.split(/\r?\n/)
      stdoutBuffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        process.stdout.write(`${line}\n`)
        try { records.push(JSON.parse(line)) } catch { /* Electron 启动日志不是协议记录。 */ }
      }
    })
    child.stderr.on('data', (chunk) => process.stderr.write(chunk))
    child.on('error', (error) => resolve({ scenario, code: 1, records, error: error.message }))
    child.on('exit', (code, signal) => {
      clearTimeout(hardTimeout)
      activeChildren.delete(child)
      if (stdoutBuffer.trim()) process.stdout.write(`${stdoutBuffer}\n`)
      resolve({
        scenario, code: signal ? 1 : (code ?? 1), records,
        error: signal ? `signal:${signal}` : (code === null ? 'hard-timeout' : null),
      })
    })
  })
}

function summarize(result) {
  const acceptance = [...result.records].reverse().find((record) => record.type === 'acceptance')?.acceptance
  const state = [...result.records].reverse().find((record) => record.type === 'finished')?.state
  const events = result.records.filter((record) => record.type === 'event').map((record) => record.event)
  const toolStarts = events.filter((event) => event?.type === 'ToolStarted')
  const scriptCalls = toolStarts.filter((event) => event.toolName === 'run_henji_script').length
  const guardFailures = events.filter((event) => event?.type === 'ToolFailed').length
  const serialized = JSON.stringify(result.records)
  const forbiddenProtocol = ['PROGRAM_RECIPE_AVAILABLE', 'execute_application_program']
    .filter((token) => serialized.includes(token))
  const reasons = []
  if (result.code !== 0) reasons.push(`子进程退出码 ${result.code}`)
  /*
   * 探针不按写入判据评估。
   *
   * 完整场景的 acceptance 要求强类型 Effect 与成功封存，那是"业务链路走通了没有"。探针问的
   * 是另一个问题——**模型认不认得这个域的词**，它是只读的，不产生任何 Effect。拿写入判据去
   * 判一条只读场景，只会得到一句必然的"没有写入"，把真正要看的东西盖住。
   *
   * 探针的判据只有两条：能力发现有没有拿到东西、模型有没有当场宣称"应用没有这个能力"。
   */
  if (result.scenario.probeOnly) {
    const discovered = toolStarts.some((event) => (
      event.toolName === 'discover_application_capabilities'
      || event.toolName === 'search_application_capabilities'
    ))
    if (!discovered) reasons.push('探针没有发起任何能力发现：模型没把这句话与该领域联系起来')
    const deniedCapability = /(没有|不支持|无法|不具备)(这个|该|此)?(能力|功能)|尚未提供/.test(
      String(state?.finalText ?? '')
    )
    if (deniedCapability) {
      reasons.push('模型宣称应用没有这个能力：该域的词汇模型对不上，或发现层没把它交出来')
    }
  } else if (!acceptance?.passed) {
    reasons.push(...(acceptance?.reasons ?? ['缺少 acceptance']))
  }
  /*
   * 判据是「有没有做完 + 有没有白干」，不是「用了几步」。
   *
   * 旧判据是 scriptCalls === 1 与 turns <= 4，和运行时那条 maxCallsPerRun: 1 同源——都在拿
   * 次数这个代理指标当效率。实测它把合法的分阶段完成判成失败：camera 场景 10 回合 5 段脚本、
   * 17 个 Effect、任务图结算完成，却因为「调用数应为 1」被记为不通过。
   *
   * 现在只设**跑飞的天花板**，用来抓真回归；效率靠 tokens/turns 这些数字自己说话，
   * 白干由 guardFailures 抓——那是事实（工具真的失败了），不是猜测。
   */
  const RUNAWAY_SCRIPT_CALLS = 8
  const RUNAWAY_TURNS = 16
  const RUNAWAY_GUARD_FAILURES = 6
  if (scriptCalls > RUNAWAY_SCRIPT_CALLS) {
    reasons.push(`run_henji_script 调用数跑飞：${scriptCalls} > ${RUNAWAY_SCRIPT_CALLS}`)
  }
  if (guardFailures > RUNAWAY_GUARD_FAILURES) {
    reasons.push(`工具失败次数过多：${guardFailures} > ${RUNAWAY_GUARD_FAILURES}`)
  }
  if (!result.scenario.external && Number(state?.usage?.turns ?? 999) > RUNAWAY_TURNS) {
    reasons.push(`主模型回合跑飞：${state?.usage?.turns ?? '未知'} > ${RUNAWAY_TURNS}`)
  }
  if (forbiddenProtocol.length > 0) reasons.push(`出现旧协议：${forbiddenProtocol.join(', ')}`)
  return {
    scenario: result.scenario.id, passed: reasons.length === 0,
    // mode/domain 进汇总：对照真机成本时要能按交互模式聚合，而不是只看场景 id。
    mode: result.scenario.mode ?? null, domain: result.scenario.domain ?? null,
    probe: Boolean(result.scenario.probeOnly),
    runId: [...result.records].reverse().find((record) => record.type === 'finished')?.runId ?? null,
    status: state?.status ?? null, modelTurns: state?.usage?.turns ?? null,
    inputTokens: state?.usage?.inputTokens ?? null, outputTokens: state?.usage?.outputTokens ?? null,
    elapsedMs: result.elapsedMs ?? null,
    scriptCalls, modelVisibleToolCalls: toolStarts.length, guardFailures,
    effectCount: acceptance?.effectCount ?? 0,
    verification: acceptance?.verificationSummary ?? '', reasons,
  }
}

;(async () => {
  const summaries = []
  for (const scenario of scenarios) {
    process.stdout.write(`${JSON.stringify({
      type: 'suite_scenario_started', scenario: scenario.id, mode: scenario.mode ?? null, nonce,
    })}\n`)
    const startedAt = Date.now()
    const result = await runScenario(scenario)
    const summary = summarize({ ...result, elapsedMs: Date.now() - startedAt })
    summaries.push(summary)
    process.stdout.write(`${JSON.stringify({ type: 'suite_scenario_finished', ...summary })}\n`)
  }
  const passed = summaries.every((summary) => summary.passed)
  process.stdout.write(`${JSON.stringify({ type: 'suite_finished', passed, nonce, scenarios: summaries })}\n`)
  process.exitCode = passed ? 0 : 1
})().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
  process.exitCode = 1
})
