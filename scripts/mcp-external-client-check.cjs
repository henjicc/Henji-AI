/**
 * 真实外部 Agent 客户端接入验收。
 *
 * 这个脚本不模拟协议，也不替客户端决定调用顺序：它只负责把一个**真实运行的痕迹 AI**
 * 连同一条真实授权交给外部 Agent 命令行，然后回到应用的正式存储里核对业务事实。
 * 「协议能连上」由 SDK 测试证明；这里要证明的是「真实 Agent 读得懂契约并自己走完全程」。
 *
 * 用法：
 *   node scripts/mcp-external-client-check.cjs --client codex
 *   node scripts/mcp-external-client-check.cjs --client claude --out .mcp-clients
 *   node scripts/mcp-external-client-check.cjs --client all
 *
 * 默认隔离临时资料目录，退出即回收；不触碰用户真实工程、设置与密钥。
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const { launchElectronApp, waitForApp } = require('./lib/electronLaunch.cjs')
const { queryApplicationLogs } = require('./lib/runtimeEvidence.cjs')

const ROOT = path.resolve(__dirname, '..')
const MAIN_ENTRY = path.join(ROOT, 'out/main/index.cjs')
const CLIENTS = ['codex', 'claude']

function parseArgs(argv) {
  const options = { clients: [], outDir: '.mcp-clients', timeoutMs: 300_000 }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--client') { options.clients.push(argv[index + 1]); index += 1 }
    else if (token.startsWith('--client=')) options.clients.push(token.slice('--client='.length))
    else if (token === '--out') { options.outDir = argv[index + 1]; index += 1 }
    else if (token === '--timeout') { options.timeoutMs = Number(argv[index + 1]); index += 1 }
    else throw new Error(`未知参数：${token}`)
  }
  const clients = options.clients.flatMap((value) => String(value).split(',')).filter(Boolean)
  options.clients = clients.includes('all') || clients.length === 0 ? [...CLIENTS] : clients
  const unknown = options.clients.filter((value) => !CLIENTS.includes(value))
  if (unknown.length > 0) throw new Error(`未知客户端：${unknown.join('、')}`)
  return options
}

/** 目标文本必须每次不同，否则"第二次运行捡到上次结果"会被误读成本次通过。 */
function nonce() {
  return `n${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 客户端命令行必须直接 spawn，不能借 shell：Windows 的 `.cmd` 垫片会把带空格与引号的
 * 提示词重新拼接，参数当场被拆断（实测 codex 报 "unexpected argument"）。
 * 这里按真实可执行文件解析：Node 垫片交给当前 Node 进程运行，原生 exe 直接启动。
 */
function resolveExecutable(name) {
  const override = process.env[`HENJI_MCP_CLIENT_${name.toUpperCase()}`]
  if (override) return { command: override, prefixArgs: [] }
  const dirs = String(process.env.PATH ?? '').split(path.delimiter).filter(Boolean)
  for (const dir of dirs) {
    const exe = path.join(dir, `${name}.exe`)
    if (fs.existsSync(exe)) return { command: exe, prefixArgs: [] }
    const cmd = path.join(dir, `${name}.cmd`)
    if (!fs.existsSync(cmd)) continue
    const shim = fs.readFileSync(cmd, 'utf8')
    const script = /"%dp0%\\([^"]+\.js)"/.exec(shim)
    if (script) return { command: process.execPath, prefixArgs: [path.join(dir, script[1])] }
    return { command: cmd, prefixArgs: [], needsShell: true }
  }
  throw new Error(`未在 PATH 中找到客户端可执行文件：${name}（可用 HENJI_MCP_CLIENT_${name.toUpperCase()} 指定绝对路径）`)
}

function runCommand(command, args, { cwd, env, timeoutMs, shell = false }) {
  return new Promise((resolve) => {
    const startedAt = Date.now()
    // stdin 必须显式关闭：留着管道会让 codex 认为"还有输入没读完"，一直等到超时。
    const child = spawn(command, args, { cwd, env, windowsHide: true, shell, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => { child.kill('SIGKILL') }, timeoutMs)
    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ code: null, durationMs: Date.now() - startedAt, stdout, stderr: `${stderr}\n${error.message}` })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, durationMs: Date.now() - startedAt, stdout, stderr })
    })
  })
}

/**
 * 指标只从客户端自己的输出里数，不替它记账。
 * 「无效调用」指客户端把参数写错或调了不存在的工具；「授权违规」指它试图越过本连接的档位。
 */
function measureTranscript(text) {
  const mentions = (pattern) => (text.match(pattern) ?? []).length
  return {
    toolMentions: mentions(/(describe_application_contract|describe_application_entities|list_application_entities|read_application_entity|change_application_entities|get_application_operation|read_application_media)/g),
    discoveryCalls: mentions(/describe_application_contract/g),
    invalidInput: mentions(/INVALID_INPUT/g),
    permissionDenied: mentions(/PERMISSION_DENIED/g),
    baselineErrors: mentions(/BASELINE_(EXPIRED|CONFLICT|TARGET_MISMATCH)/g),
    operationConflicts: mentions(/OPERATION_INPUT_CONFLICT/g),
  }
}

function buildGoal({ createName, renameTo }) {
  return [
    '你连接了一个名为 henji 的 MCP 服务，它是本机正在运行的痕迹 AI 桌面应用。',
    '请只使用该 MCP 服务提供的工具完成下面的任务，不要读写本地文件，也不要执行 shell 命令：',
    '1. 先调用 describe_application_contract 了解可用能力与写入约定；',
    `2. 在素材域新建一个名为「${createName}」的素材集合；`,
    `3. 把它改名为「${renameTo}」；`,
    '4. 读取改名后的集合，确认名称确实已经变成新名字。',
    '写入工具需要你自己生成一个 UUID 作为 operationId，并把写入目标（以及新建时的父容器）先读一遍，把读取返回的 baselineId 放进 baselineIds。',
    '不要传 expectedRevisions。完成后用一句话回答最终集合的名称与 id。',
  ].join('\n')
}

function bearerToken(config) {
  return config.headers.Authorization.replace(/^Bearer\s+/, '')
}

/**
 * 两个客户端的连接语法确实不同，差异全部落在配置层：
 * Codex 用 TOML 的 `mcp_servers.<名>`，令牌只能经**环境变量名**注入，不接受字面 header；
 * Claude Code 用通用 `mcpServers` JSON，可以直接给 `headers.Authorization`。
 * 两边指向的 url 与 Bearer 事实完全一致，领域侧没有任何分支。
 */
const CLIENT_ADAPTERS = {
  codex: {
    executable: () => resolveExecutable('codex'),
    /**
     * 只证明配置语法被客户端接受并解析成正确的传输事实。
     * **它不是握手证据**：`codex mcp list` 回显的是配置，不发起 initialize；
     * 真正的握手只发生在 `codex exec` 里，需要可用的模型额度。
     */
    configArgs: ({ config, home }) => ({
      args: ['mcp', 'list', '--json',
        '-c', `mcp_servers.henji.url=${JSON.stringify(config.url)}`,
        '-c', 'mcp_servers.henji.bearer_token_env_var="HENJI_MCP_TOKEN"',
        '-c', 'mcp_servers.henji.startup_timeout_sec=60'],
      env: { HENJI_MCP_TOKEN: bearerToken(config), CODEX_HOME: home },
      expect: /"type":\s*"streamable_http"/,
    }),
    taskArgs: ({ config, goal, cwd }) => ({
      args: ['exec', '--skip-git-repo-check', '-s', 'read-only',
        '-c', 'approval_policy="never"',
        '-c', 'model_reasoning_effort="low"',
        '-c', `mcp_servers.henji.url=${JSON.stringify(config.url)}`,
        '-c', 'mcp_servers.henji.bearer_token_env_var="HENJI_MCP_TOKEN"',
        '-c', 'mcp_servers.henji.startup_timeout_sec=60',
        '-C', cwd, goal],
      env: { HENJI_MCP_TOKEN: bearerToken(config) },
    }),
  },
  claude: {
    executable: () => resolveExecutable('claude'),
    // `claude mcp list` 不接受根命令的 `--mcp-config`，没有独立的配置回显入口；
    // 配置是否被接受只能由任务运行本身体现，这里不编造一个"连接已通过"。
    configArgs: null,
    taskArgs: ({ config, goal, cwd }) => ({
      args: ['-p', goal,
        '--mcp-config', JSON.stringify({ mcpServers: { henji: { type: 'http', url: config.url, headers: config.headers } } }),
        '--strict-mcp-config', '--model', 'sonnet', '--max-turns', '30',
        '--output-format', 'json', '--permission-mode', 'bypassPermissions', '--add-dir', cwd],
      env: {},
    }),
  },
}

async function readLibraries(page) {
  return page.evaluate(() => window.henjiNative.assetLibrary.listLibraries())
}

async function runClient(client, { page, config, outDir, timeoutMs }) {
  const adapter = CLIENT_ADAPTERS[client]
  const executable = adapter.executable()
  const marker = nonce()
  const createName = `MCP外部客户端-${marker}`
  const renameTo = `MCP外部客户端-${marker}-已改名`
  const goal = buildGoal({ createName, renameTo })
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), `henji-mcp-${client}-`))
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `henji-mcp-home-${client}-`))
  const invoke = async (phase, plan) => {
    const run = await runCommand(executable.command, [...executable.prefixArgs, ...plan.args], {
      cwd, env: { ...process.env, ...plan.env }, timeoutMs, shell: executable.needsShell === true,
    })
    const transcript = `${run.stdout}\n${run.stderr}`
    fs.writeFileSync(path.join(outDir, `${client}-${phase}.txt`), transcript, 'utf8')
    return { ...run, transcript }
  }
  let configAccepted = null
  if (adapter.configArgs) {
    const plan = adapter.configArgs({ config, home })
    console.log(`\n[${client}] 连接配置解析……`)
    const echo = await invoke('config', plan)
    configAccepted = echo.code === 0 && plan.expect.test(echo.transcript)
    console.log(`[${client}] 配置${configAccepted ? '被接受并解析为回环 Streamable HTTP + Bearer' : '未被接受'}`)
  }

  const before = await readLibraries(page)
  const startedAt = new Date().toISOString()
  console.log(`[${client}] 启动真实 Agent 任务……`)
  const run = await invoke('task', adapter.taskArgs({ config, goal, cwd, home }))
  const transcript = run.transcript
  /*
   * 握手与调用只认服务端记账：客户端会把工具名原样回显在提示词里，
   * 拿 transcript 里出现过工具名当"调用过"是彻头彻尾的假证据。
   */
  const logs = await queryApplicationLogs(page, { afterTimestamp: startedAt, endTimestamp: new Date().toISOString(), level: 'info' })
  const sessions = logs.events.filter((event) => event.event === 'mcp.session.opened')
  const dispatched = logs.events.filter((event) => event.event === 'mcp.read.start' || event.event === 'mcp.write.start')
  const finished = logs.events.filter((event) => event.event === 'mcp.read.completed' || event.event === 'mcp.write.completed')
  const firstEffective = finished.find((event) => event.context?.ok === true)
  const after = await readLibraries(page)
  const created = after.filter((item) => item.name === createName)
  const renamed = after.filter((item) => item.name === renameTo)
  const beforeIds = new Set(before.map((item) => String(item.id)))
  const added = after.filter((item) => !beforeIds.has(String(item.id)))
  const metrics = measureTranscript(transcript)
  // 模型侧不可用（额度、认证、版本）与"应用能力走不通"是两回事，必须分开记。
  const modelBlocked = /usage limit|not supported when using Codex|requires a newer version|invalid_authentication|Invalid API key|Not logged in|Credit balance|rate.?limit/i.exec(transcript)
  const result = {
    client,
    executable: `${executable.command}${executable.prefixArgs.length ? ` ${executable.prefixArgs.join(' ')}` : ''}`,
    connection: {
      configAccepted,
      handshakeVerified: sessions.length > 0,
      clients: sessions.map((event) => `${event.context?.clientName ?? '未知'}/${event.context?.clientVersion ?? '未知'}`),
      dispatchedCalls: dispatched.length,
      firstEffectiveCallMs: firstEffective ? Date.parse(firstEffective.timestamp) - Date.parse(startedAt) : null,
    },
    modelBlocked: modelBlocked ? modelBlocked[0] : null,
    exitCode: run.code,
    durationMs: run.durationMs,
    goalMarker: marker,
    // 业务真相只从正式存储读：客户端说完成了不算数。
    businessTruth: {
      renamedLibraries: renamed.length,
      leftoverOriginalName: created.length,
      newLibrariesTotal: added.length,
      renamedId: renamed[0] ? String(renamed[0].id) : null,
    },
    metrics,
    completed: renamed.length === 1 && created.length === 0 && added.length === 1,
  }
  // 清理本次自己创建的夹具：临时资料目录退出即回收，这里仍显式删一遍，保证"只清自己建的"。
  for (const library of added) {
    await page.evaluate((id) => window.henjiNative.assetLibrary.deleteLibrary(id), library.id).catch(() => undefined)
  }
  console.log(`[${client}] 退出码 ${run.code}，耗时 ${(run.durationMs / 1000).toFixed(1)}s，业务真相：${JSON.stringify(result.businessTruth)}`)
  return result
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const outDir = path.isAbsolute(options.outDir) ? options.outDir : path.resolve(ROOT, options.outDir)
  fs.mkdirSync(outDir, { recursive: true })
  const port = 43900 + Math.floor(Math.random() * 80)
  const app = await launchElectronApp({
    mainEntry: MAIN_ENTRY, cwd: ROOT, isolateUserData: true, useElectronApi: true, skipOnboarding: true,
  })
  const results = []
  try {
    await waitForApp(app.page)
    const config = await app.page.evaluate(async ({ targetPort, connectionName }) => {
      await window.henjiNative.mcp.configure({ enabled: true, port: targetPort })
      const identity = await window.henjiNative.mcp.authorize({ name: connectionName, allowWrites: true, allowDestructive: false, allowPaid: false })
      const deadline = Date.now() + 15000
      while (Date.now() < deadline) {
        if ((await window.henjiNative.mcp.status()).ready) break
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      const raw = await window.henjiNative.mcp.connectionConfig({ id: identity.id })
      return { id: identity.id, ...JSON.parse(raw).mcpServers.henji }
    }, { targetPort: port, connectionName: `外部客户端验收-${randomUUID().slice(0, 8)}` })
    console.log(`应用已就绪，连接端点 ${config.url}（修改档，未授权删除与付费）`)
    for (const client of options.clients) {
      results.push(await runClient(client, { page: app.page, config, outDir, timeoutMs: options.timeoutMs }))
    }
  } finally {
    await app.close()
  }
  const summary = { startedAt: new Date().toISOString(), platform: `${process.platform} ${os.release()}`, results }
  fs.writeFileSync(path.join(outDir, 'clients.json'), JSON.stringify(summary, null, 2), 'utf8')
  console.log(`\n证据目录：${outDir}`)
  for (const result of results) {
    console.log(`- ${result.client}：配置${result.connection.configAccepted === null ? '未单独取证' : result.connection.configAccepted ? '接受' : '拒绝'}，`
      + `握手${result.connection.handshakeVerified ? `已验证（${result.connection.clients.join('、')}）` : '未验证'}，`
      + `派发调用 ${result.connection.dispatchedCalls} 次，任务${result.completed ? '完成' : result.modelBlocked ? `阻塞（${result.modelBlocked}）` : '未完成'}`)
  }
  const failed = results.filter((result) => !result.completed && !result.modelBlocked)
  if (failed.length > 0) throw new Error(`${failed.map((result) => result.client).join('、')} 未完成声明范围的业务链`)
  /*
   * 模型侧阻塞不判失败——那不是应用的问题——但也**绝不能被读成通过**。
   * 没有任何客户端跑完业务链时，这里必须把话说死，免得一条绿线被当成"真实 Agent 已验收"。
   */
  if (!results.some((result) => result.completed)) {
    console.log('\n⚠ 本次没有任何客户端完成业务链：连接与协议会话已取证，任务级完成率仍为未取证（模型侧阻塞）。')
  }
}

main().catch((error) => {
  console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
