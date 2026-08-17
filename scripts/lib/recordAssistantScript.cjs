/**
 * 把一次**真机运行**录制成剧本，供 L-B harness 回放。
 *
 * ── 为什么录而不是手写 ──
 * 手写正路剧本等于我替模型想它会怎么做，必然漂移到不现实；真模型写出来的脚本才代表模型
 * 实际会写什么。手写只留给故意的坏输入（撞墙、拒绝、歧义），那些真模型很难稳定复现。
 *
 * ── 为什么读 trace 而不是事件流 ──
 * `agent_events` 的 ToolRequested 只存 `inputDigest`，**没有入参**（见 core/assistant/events.ts）。
 * 含完整 toolCall 入参的只有 `agent_model_traces.detail_json.response.toolCalls`，
 * 需要运行时带 `--trace detailed`。
 *
 * ── 三道拒绝，一条都不能省 ──
 * 录制器最危险的失败模式不是报错，是**静默产出一份失真的剧本**：那会让回放长期跑在幻觉
 * 数据上，比没有录制更糟。所以下面三种情况一律硬失败或显式告警，不做"尽力而为"：
 *   1. detail 被截断且 response 段落丢失 → 剧本会缺步
 *   2. 入参里出现 `***` → 敏感键被脱敏，值已经不是真的
 *   3. 入参里焊着运行时产物 id → 换个环境回放必然指向不存在的东西
 */
const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..', '..')

function databasePath() {
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, 'com.henji.ai', 'Henji-AI', 'henji.db')
  }
  const base = process.platform === 'darwin'
    ? path.join(require('node:os').homedir(), 'Library', 'Application Support')
    : process.env.XDG_CONFIG_HOME || path.join(require('node:os').homedir(), '.config')
  return path.join(base, 'com.henji.ai', 'Henji-AI', 'henji.db')
}

/**
 * 运行时产物 id 的形状。
 *
 * 只认这几类有明确前缀或 uuid 形状的串——宁可漏报也不要误报：把一个正常业务值标成产物 id，
 * 人就会去参数化一个本来该写死的东西，剧本反而更脆。
 */
const PRODUCT_ID_PATTERNS = [
  /\btask-[a-z0-9]{6,}-[a-z0-9]{4,}\b/gi,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
]

function fail(message) {
  process.stderr.write(`[record-assistant-script] ${message}\n`)
  process.exit(1)
}

function parseArgs(argv) {
  const args = { runId: null, out: null, nonce: null, list: false }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--run') args.runId = argv[index + 1]
    else if (flag === '--out') args.out = argv[index + 1]
    else if (flag === '--nonce') args.nonce = argv[index + 1]
    else if (flag === '--list') args.list = true
  }
  return args
}

/** 从目标文本里认出那个"每次跑都不一样"的唯一名，供反向替换成占位符。 */
function detectNonce(goal, explicit) {
  if (explicit) return explicit
  // live-suite 现有的 stamp 形状：14 位时间戳。新形状（36 进制随机串）由 --nonce 显式传入。
  const stamp = /\b\d{14}\b/.exec(goal ?? '')
  return stamp ? stamp[0] : null
}

function replaceNonce(value, nonce) {
  if (!nonce) return value
  return JSON.parse(JSON.stringify(value).split(nonce).join('{{nonce}}'))
}

function collectStrings(value, out = []) {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) for (const item of value) collectStrings(item, out)
  else if (value && typeof value === 'object') for (const item of Object.values(value)) collectStrings(item, out)
  return out
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const dbPath = databasePath()
  if (!fs.existsSync(dbPath)) fail(`未找到应用数据库：${dbPath}`)

  let Database
  try {
    Database = require(path.join(projectRoot, 'node_modules', 'better-sqlite3'))
  } catch (error) {
    fail(
      `无法加载 better-sqlite3（${error.message}）。`
      + '它是按 Electron ABI 编译的，必须通过 npm run assistant:record 启动。'
    )
  }
  const db = new Database(dbPath, { readonly: true })

  if (args.list || !args.runId) {
    const rows = db.prepare(`
      SELECT r.run_id, r.status, r.goal, COUNT(t.trace_id) AS steps, MAX(t.started_at) AS at
      FROM agent_runs r
      LEFT JOIN agent_model_traces t ON t.run_id = r.run_id AND t.step_kind = 'primary'
      GROUP BY r.run_id HAVING steps > 0
      ORDER BY at DESC LIMIT 20
    `).all()
    for (const row of rows) {
      process.stdout.write(`${row.run_id}  ${row.status}  步数=${row.steps}  ${String(row.goal ?? '').slice(0, 48)}\n`)
    }
    if (!args.runId) fail('缺少 --run <runId>；上面是最近可录制的运行。')
    return
  }

  const runRow = db.prepare('SELECT goal, status FROM agent_runs WHERE run_id = ?').get(args.runId)
  if (!runRow) fail(`运行不存在：${args.runId}`)

  const rows = db.prepare(`
    SELECT step_id, detail_json, detail_truncated, capture_mode
    FROM agent_model_traces
    WHERE run_id = ? AND step_kind = 'primary' AND detail_json IS NOT NULL
    ORDER BY started_at ASC
  `).all(args.runId)
  if (rows.length === 0) fail(`该运行没有可录制的主模型步骤；确认跑的时候带了 --trace detailed。`)

  const nonce = detectNonce(runRow.goal, args.nonce)
  const warnings = []
  const steps = []

  for (const row of rows) {
    let detail
    try {
      detail = JSON.parse(row.detail_json)
    } catch {
      fail(`步骤 ${row.step_id} 的 detail 无法解析，录制中止。`)
    }
    if (row.capture_mode !== 'detailed') {
      fail(`步骤 ${row.step_id} 的追踪模式是 ${row.capture_mode}，缺少完整响应；请用 --trace detailed 重跑。`)
    }
    if (detail.response === '[trace-section-truncated]' || !detail.response) {
      fail(
        `步骤 ${row.step_id} 的 response 段落被截断（detail_truncated=${row.detail_truncated}）。`
        + '这份剧本会缺步，宁可不录也不能录一份失真的。'
      )
    }

    const response = detail.response
    const toolCalls = Array.isArray(response.toolCalls) ? response.toolCalls : []
    const serialized = JSON.stringify(toolCalls)
    if (serialized.includes('***')) {
      fail(
        `步骤 ${row.step_id} 的入参里有被脱敏的 \`***\`（敏感键在写入 trace 时已被替换）。`
        + '录下来的不是真值，回放没有意义。'
      )
    }

    // 产物 id 检测：出现在本步入参、且在本步之前的对话里出现过 = 上游步骤产出的运行时值。
    const history = JSON.stringify(detail.logicalRequest?.messages ?? [])
    for (const literal of collectStrings(toolCalls)) {
      for (const pattern of PRODUCT_ID_PATTERNS) {
        pattern.lastIndex = 0
        for (const match of literal.match(pattern) ?? []) {
          if (!history.includes(match)) continue
          warnings.push(
            `步骤 ${row.step_id} 的入参里焊着运行时产物 id \`${match}\`：`
            + '它来自上游步骤的真实输出，换个环境回放会指向不存在的东西。'
            + '把它改写成对前序步骤结果的引用，或把这条剧本降级为手写。'
          )
        }
      }
    }

    const actions = []
    if (typeof response.reasoningText === 'string' && response.reasoningText) {
      actions.push({ type: 'reasoning', value: response.reasoningText })
    }
    if (typeof response.text === 'string' && response.text) {
      actions.push({ type: 'text', value: response.text })
    }
    for (const toolCall of toolCalls) {
      actions.push({
        type: 'tool_call',
        toolCall: {
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          input: toolCall.input,
          dynamic: Boolean(toolCall.dynamic),
        },
      })
    }
    actions.push({
      type: 'finish',
      reason: toolCalls.length > 0 ? 'tool-calls' : 'stop',
    })
    steps.push({ stepId: row.step_id, actions })
  }

  const fixture = replaceNonce({
    schemaVersion: 1,
    recordedFrom: {
      runId: args.runId,
      status: runRow.status,
      goal: runRow.goal ?? '',
      stepCount: steps.length,
    },
    /* 录制当天的唯一名已被替换成 {{nonce}}；回放时注入固定值，真机跑仍生成新的随机值。 */
    nonce: nonce ? '{{nonce}}' : null,
    steps,
    warnings,
  }, nonce)

  const outPath = args.out
    ? path.resolve(projectRoot, args.out)
    : path.join(projectRoot, 'src', 'tests', 'fixtures', `${args.runId.slice(0, 8)}.recorded.json`)
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8')

  process.stdout.write(`已录制 ${steps.length} 个模型步骤 → ${path.relative(projectRoot, outPath)}\n`)
  if (nonce) process.stdout.write(`唯一名 ${nonce} 已替换为 {{nonce}}\n`)
  for (const warning of [...new Set(warnings)]) process.stdout.write(`⚠ ${warning}\n`)
  if (warnings.length > 0) {
    process.stdout.write('存在未参数化的运行时产物 id：回放前必须处理，否则剧本会随环境漂移。\n')
  }
}

main()
