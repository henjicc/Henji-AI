const { spawn, spawnSync } = require('node:child_process')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const runner = path.join(__dirname, 'run-assistant-cli.cjs')
const rawArgs = process.argv.slice(2)
const visible = rawArgs.includes('--visible')
const skipGeneration = rawArgs.includes('--skip-generation')
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

const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
const scenarios = [
  {
    id: 'camera',
    goal: `新建一个名为“自动验收-${stamp}-三维”的 3D 工程，放入一个球体，`+
      '让它在 0、1、2 秒的 y 坐标分别为 0、1.5、0，开启循环并播放；最后从正式场景状态验证三枚状态关键帧和播放状态。',
  },
  {
    id: 'assets',
    goal: `创建名为“自动验收-${stamp}-素材库”的素材库，把它改名为“自动验收-${stamp}-已改名”，`+
      '从正式素材库列表确认新名称后删除它，并再次确认它已不存在。',
  },
  {
    id: 'canvas',
    goal: `新建名为“自动验收-${stamp}-画布”的画布工程，创建一个文本提示词节点和一个图片节点，`+
      '把文本节点移动到明确坐标并连接到图片节点；最后读取正式画布图结构验证节点、位置和连线。',
  },
  {
    id: 'settings',
    goal: '先读取 general.language 与 interface.theme_tone 的当前真实值；用一次 Henji Script 修改并读回验证，随后仍在同一脚本中恢复原值并再次读回验证。',
  },
  {
    id: 'generation', external: true,
    goal: `生成一张“暖色极简几何山谷、无文字”的图片，并创建名为“自动验收-${stamp}-生成画布”的画布工程；`+
      '等待生成权威成功状态后，把真实 generation.result 放入画布，最后读取正式画布确认媒体节点存在。',
  },
].filter((scenario) => (!skipGeneration || !scenario.external) && (!only || scenario.id === only))

if (scenarios.length === 0) {
  process.stderr.write(`没有匹配的场景：${only ?? '(空)'}\n`)
  process.exit(1)
}

function runScenario(scenario) {
  return new Promise((resolve) => {
    const args = [runner, '--goal', scenario.goal, '--trace', 'detailed', '--require-verified-write',
      '--approval', approvalMode, '--timeout', String(timeoutMs)]
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
  if (!acceptance?.passed) reasons.push(...(acceptance?.reasons ?? ['缺少 acceptance']))
  if (scriptCalls !== 1) reasons.push(`run_henji_script 调用数应为 1，实际 ${scriptCalls}`)
  if (!result.scenario.external && Number(state?.usage?.turns ?? 999) > 4) {
    reasons.push(`主模型回合超过 4：${state?.usage?.turns ?? '未知'}`)
  }
  if (forbiddenProtocol.length > 0) reasons.push(`出现旧协议：${forbiddenProtocol.join(', ')}`)
  return {
    scenario: result.scenario.id, passed: reasons.length === 0,
    runId: [...result.records].reverse().find((record) => record.type === 'finished')?.runId ?? null,
    status: state?.status ?? null, modelTurns: state?.usage?.turns ?? null,
    inputTokens: state?.usage?.inputTokens ?? null, outputTokens: state?.usage?.outputTokens ?? null,
    scriptCalls, modelVisibleToolCalls: toolStarts.length, guardFailures,
    effectCount: acceptance?.effectCount ?? 0,
    verification: acceptance?.verificationSummary ?? '', reasons,
  }
}

;(async () => {
  const summaries = []
  for (const scenario of scenarios) {
    process.stdout.write(`${JSON.stringify({ type: 'suite_scenario_started', scenario: scenario.id, stamp })}\n`)
    const summary = summarize(await runScenario(scenario))
    summaries.push(summary)
    process.stdout.write(`${JSON.stringify({ type: 'suite_scenario_finished', ...summary })}\n`)
  }
  const passed = summaries.every((summary) => summary.passed)
  process.stdout.write(`${JSON.stringify({ type: 'suite_finished', passed, stamp, scenarios: summaries })}\n`)
  process.exitCode = passed ? 0 : 1
})().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
  process.exitCode = 1
})
