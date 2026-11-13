#!/usr/bin/env node
/*
 * 助手工具面基线：同一组固定任务，每合并一批工具后重跑，对比成功率、步数、token 与耗时。
 *
 * 用法（仓库根目录）：
 *   node docs/task/助手工具面分层/baseline.cjs --label 基线-11-14            全部任务各跑 2 次
 *   node docs/task/助手工具面分层/baseline.cjs --label 试跑 --only V1,C2 --runs 1
 *   node docs/task/助手工具面分层/baseline.cjs --static                        只统计工具面体积，不跑助手
 *
 * 跑在真实配置与真实数据目录上（assistant:cli 无窗口实例，可与带窗口的应用并存）：
 * 只在项目“工具面基线 11-14”里新建文档，不调付费能力。需要最新的 out/ 产物（electron:bundle）。
 * 无窗口实例关了显卡，任务里不含取帧、导出这类要合成画面的步骤。
 */
const { execFileSync, spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', '..', '..')
const PROJECT = '工具面基线 11-14'
const FIXTURES = path.join(os.tmpdir(), 'henji-tool-surface-baseline')
const VIDEO = path.join(FIXTURES, 'clip-6s.mp4').replace(/\\/g, '/')
const IMAGE = path.join(FIXTURES, 'still.png').replace(/\\/g, '/')
const AUDIO = path.join(FIXTURES, 'voice-10s.wav').replace(/\\/g, '/')

const args = process.argv.slice(2)
const option = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback }
const label = option('--label', `run-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`)
const runs = Number(option('--runs', '2'))
const only = option('--only', '')?.split(',').filter(Boolean)

const RULES = `全程只在项目“${PROJECT}”里操作，不要改动其他项目和文档；不要调用任何付费能力（生成、转写、识别、翻译）；不要往素材库里加东西（素材直接按路径导入到文档里）；不要打开或切换界面。`
const tail = (shape) => `做完后从应用里读回核对，回复的最后一行必须是：RESULT: ${shape}（单行 JSON，数值取读回结果，不要凭记忆填）。`
const near = (value, target, tolerance) => typeof value === 'number' && Math.abs(value - target) <= tolerance

/** 每条任务自带文档，互不依赖；name 由脚本给出，保证每次运行新建。 */
const TASKS = [
  { id: 'V1', area: '剪辑', title: '搭时间线：视频、图片、文字',
    goal: (name) => `${RULES}新建剪辑“${name}”。导入视频 ${VIDEO}（6 秒）和图片 ${IMAGE}，把视频放在序列开头，图片紧接在视频后面、持续 3 秒；再在图片上方的轨道加一个文字片段，内容“基线测试”，与图片同起止。${tail('{"imageStartSeconds":数字,"imageDurationSeconds":数字,"textStartSeconds":数字,"text":"文字内容"}')}`,
    check: (r) => near(r.imageStartSeconds, 6, 0.1) && near(r.imageDurationSeconds, 3, 0.1) && near(r.textStartSeconds, 6, 0.1) && r.text === '基线测试' },
  { id: 'V2', area: '剪辑', title: '拆分、改属性、撤销',
    goal: (name) => `${RULES}新建剪辑“${name}”。导入视频 ${VIDEO} 放在序列开头；在第 2 秒处把它拆成两段；记下后半段画面片段当前的不透明度和缩放，然后在一次修改里把后半段的不透明度降到一半、缩放改成 80%；接着撤销刚才这一次修改。${tail('{"videoClips":画面片段数,"secondStartSeconds":数字,"opacityBefore":数字,"opacityAfterUndo":数字,"scaleBefore":数字,"scaleAfterUndo":数字}')}`,
    check: (r) => r.videoClips === 2 && near(r.secondStartSeconds, 2, 0.1) && typeof r.opacityBefore === 'number' && r.opacityBefore === r.opacityAfterUndo && typeof r.scaleBefore === 'number' && r.scaleBefore === r.scaleAfterUndo },
  { id: 'V3', area: '剪辑', title: '批量摆片段、批量改属性、加标记',
    goal: (name) => `${RULES}新建剪辑“${name}”。导入图片 ${IMAGE}，在同一条画面轨道上依次放 6 个这张图片的片段，每个 1 秒、首尾相接；把第 2、4、6 个的不透明度设成一半；在第 1、3、5 秒各加一个时间标记，名字分别是 A、B、C。${tail('{"clips":数字,"halfOpacityClips":数字,"markers":数字,"lastClipEndSeconds":数字}')}`,
    check: (r) => r.clips === 6 && r.halfOpacityClips === 3 && r.markers === 3 && near(r.lastClipEndSeconds, 6, 0.1) },
  { id: 'C1', area: '画布', title: '建节点并连线',
    goal: (name) => `${RULES}新建画布“${name}”。添加 3 个文本节点，内容分别是“甲”“乙”“丙”，横向排开；再添加一个图片生成节点（只放节点，不要提交生成），把“甲”连到它的提示词输入。${tail('{"nodes":数字,"edges":数字,"texts":["…","…","…"]}')}`,
    check: (r) => r.nodes === 4 && r.edges === 1 && Array.isArray(r.texts) && ['甲', '乙', '丙'].every((text) => r.texts.includes(text)) },
  { id: 'C2', area: '画布', title: '组合、复制、删除、撤销删除',
    goal: (name) => `${RULES}新建画布“${name}”。添加 4 个文本节点，内容分别是“一”“二”“三”“四”；把“一”和“二”组合成一个组；复制“三”；删除“四”，然后撤销这次删除让“四”回来；最后整理一下布局。${tail('{"textNodes":数字,"groups":数字,"fourExists":true或false}')}`,
    check: (r) => r.textNodes === 5 && r.groups === 1 && r.fourExists === true },
  { id: 'I1', area: '修图', title: '建图片文档、改图层属性',
    goal: (name) => `${RULES}新建图片文档“${name}”，把图片 ${IMAGE} 作为图层放进去；把这个图层改名为“底图”，不透明度设为 80%。${tail('{"layers":数字,"layerName":"…","opacityPercent":数字}')}`,
    check: (r) => r.layers >= 1 && r.layerName === '底图' && near(r.opacityPercent, 80, 0.5) },
  { id: 'I2', area: '修图', title: '加滤镜、旋转、撤销旋转',
    goal: (name) => `${RULES}新建图片文档“${name}”，把图片 ${IMAGE} 作为图层放进去；给这个图层加一个调亮画面的滤镜；再把整张图片顺时针旋转 90 度；然后撤销旋转这一步（滤镜要保留）。${tail('{"filters":数字,"rotationDegrees":数字}')}`,
    check: (r) => r.filters === 1 && r.rotationDegrees === 0 },
  { id: 'A1', area: '音频', title: '导入声音、加删除与静音区间',
    goal: (name) => `${RULES}新建口播“${name}”，导入声音 ${AUDIO}（10 秒，不要转写）；把第 2 到 3 秒删除，把第 5 到 6 秒静音。${tail('{"cuts":声音编辑区间数,"sourceDurationSeconds":数字}')}`,
    check: (r) => r.cuts === 2 && near(r.sourceDurationSeconds, 10, 0.2) },
  { id: 'A2', area: '音频', title: '匹配响度、读回、撤销',
    goal: (name) => `${RULES}新建口播“${name}”，导入声音 ${AUDIO}（10 秒，不要转写）；先读回成品的整体响度，再把响度匹配到 -16 LUFS 并读回；然后撤销响度匹配这一步，再读回一次。${tail('{"lufsBefore":数字,"lufsAfterMatch":数字,"lufsAfterUndo":数字}')}`,
    // 测试声音很轻、峰值有限，匹配会被真峰值上限挡在 -16 之前：只核对明显抬高，并且撤销后回到原值。
    check: (r) => typeof r.lufsBefore === 'number' && r.lufsAfterMatch <= -14 && r.lufsAfterMatch - r.lufsBefore >= 10 && near(r.lufsAfterUndo, r.lufsBefore, 0.5) },
]

function ensureFixtures() {
  fs.mkdirSync(FIXTURES, { recursive: true })
  const ffmpeg = (output, ...rest) => { if (!fs.existsSync(output)) execFileSync('ffmpeg', ['-v', 'error', '-y', ...rest, output]) }
  ffmpeg(VIDEO, '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=6', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest')
  ffmpeg(IMAGE, '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=1:duration=1', '-frames:v', '1')
  // 一秒有声一秒无声交替、整体偏轻：响度匹配有明确可量的变化。
  ffmpeg(AUDIO, '-f', 'lavfi', '-i', 'sine=frequency=220:duration=10', '-af', "volume='if(lt(mod(t,2),1.2),0.08,0)':eval=frame", '-ar', '48000', '-ac', '1')
}

/** 对外工具面的静态体积：外部客户端一次列出全部工具时要读进上下文的量。 */
function staticSurface() {
  const { buildSync } = require(path.join(ROOT, 'node_modules', 'esbuild'))
  const entry = path.join(FIXTURES, 'surface-entry.ts')
  fs.mkdirSync(FIXTURES, { recursive: true })
  fs.writeFileSync(entry, `import { BUILTIN_APPLICATION_CAPABILITIES } from '@/core/application-control/builtinApplicationCapabilityRegistry'
import { isExternalApplicationTool } from '@/core/application-control/externalCapabilityPolicy'
import { z } from 'zod'
const tools = BUILTIN_APPLICATION_CAPABILITIES.filter(isExternalApplicationTool)
const byDomain: Record<string, number> = {}
let schemaChars = 0, descriptionChars = 0
for (const tool of tools) { byDomain[tool.domain] = (byDomain[tool.domain] ?? 0) + 1; schemaChars += JSON.stringify(z.toJSONSchema(tool.inputSchema, { io: 'input', reused: 'ref' })).length; descriptionChars += tool.title.length + tool.description.length }
console.log(JSON.stringify({ capabilityTools: tools.length, hiddenDefinitions: BUILTIN_APPLICATION_CAPABILITIES.length - tools.length, inputSchemaChars: schemaChars, descriptionChars, byDomain }))
`)
    const output = path.join(FIXTURES, 'surface-entry.cjs')
  buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile: output, alias: { '@': path.join(ROOT, 'src') }, nodePaths: [path.join(ROOT, 'node_modules')], external: ['electron'], logLevel: 'error' })
  return JSON.parse(execFileSync(process.execPath, [output], { encoding: 'utf8' }).trim().split('\n').at(-1))
}

const MAX_INPUT_TOKENS = Number(option('--max-input-tokens', '1000000'))
const MAX_TOOL_CALLS = Number(option('--max-tool-calls', '30'))

function readChain(runId) {
  try { return JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'query-logs.cjs'), '--chain', runId, '--json'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })) } catch { return null }
}

/** 用量按每轮模型请求累加，运行中途也能读，供超限中止与事后统计共用。 */
function measure(chain) {
  const toolSteps = chain.steps.filter((step) => step.kind === 'tool')
  const names = toolSteps.map((step) => step.data?.toolName)
  const usages = chain.steps.filter((step) => step.kind === 'model').map((step) => step.data?.usage ?? {})
  const sum = (key) => usages.reduce((total, usage) => total + (usage[key] ?? 0), 0)
  return {
    modelRequests: usages.length,
    toolCalls: names.filter((toolName) => toolName !== 'load_application_tools').length,
    toolLoads: names.filter((toolName) => toolName === 'load_application_tools').length,
    failedToolCalls: toolSteps.filter((step) => step.data?.isError || step.data?.result?.ok === false).length,
    inputTokens: sum('input') + sum('cacheRead'), freshInputTokens: sum('input'), outputTokens: sum('output'),
    costCny: Math.round(sum('cost') * 10000) / 10000,
    largestRequestTokens: Math.max(0, ...usages.map((usage) => (usage.input ?? 0) + (usage.cacheRead ?? 0))),
    paidCalls: toolSteps.filter((step) => step.data?.paid).length,
    distinctTools: [...new Set(names)].length,
    tools: names,
  }
}

function killTree(pid) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
  else process.kill(pid, 'SIGKILL')
}

/** 运行一次；累计输入 token 或工具调用超过上限就中止这次运行，记为“失败（超限）”。 */
function runOnce(task, index) {
  return new Promise((resolve) => {
    const name = `${task.id}-${label}-${index + 1}-${Date.now().toString(36)}`
    const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'run-assistant-cli.cjs'), '--goal', task.goal(name), '--trace', 'summary', '--timeout', '900000'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
    const startedAt = Date.now()
    let stdout = ''
    let runId
    let overLimit = null
    child.stdout.on('data', (chunk) => { stdout += chunk; runId ??= /"runId":"([^"]+)"/.exec(stdout)?.[1] })
    const watch = setInterval(() => {
      if (!runId || overLimit) return
      const chain = readChain(runId)
      if (!chain) return
      const now = measure(chain)
      if (now.inputTokens > MAX_INPUT_TOKENS) overLimit = `输入 token 超过 ${MAX_INPUT_TOKENS}`
      else if (now.toolCalls > MAX_TOOL_CALLS) overLimit = `工具调用超过 ${MAX_TOOL_CALLS} 次`
      if (overLimit) killTree(child.pid)
    }, 8000)
    child.on('exit', (code) => {
      clearInterval(watch)
      const records = stdout.split('\n').filter((line) => line.startsWith('{')).flatMap((line) => { try { return [JSON.parse(line)] } catch { return [] } })
      const finished = records.find((record) => record.type === 'finished')
      const status = overLimit ? `失败（超限：${overLimit}）` : finished?.status ?? records.find((record) => record.type === 'error')?.message ?? `退出码 ${code}`
      const row = { task: task.id, run: index + 1, document: name, runId, status, durationMs: finished?.durationMs ?? Date.now() - startedAt }
      const chain = runId ? readChain(runId) : null
      if (!chain) { resolve({ ...row, pass: false, note: '日志链路读不到' }); return }
      const match = /RESULT:\s*(\{.*\})\s*$/m.exec(chain.answer ?? '')
      let result = null
      try { result = match ? JSON.parse(match[1]) : null } catch { result = null }
      resolve({ ...row, pass: !overLimit && finished?.status === 'completed' && Boolean(result) && task.check(result), result, ...measure(chain) })
    })
  })
}

function summarize(rows) {
  return TASKS.filter((task) => rows.some((row) => row.task === task.id)).map((task) => {
    const own = rows.filter((row) => row.task === task.id)
    const average = (key) => Math.round(own.reduce((sum, row) => sum + (row[key] ?? 0), 0) / own.length)
    return { task: task.id, area: task.area, title: task.title, passed: `${own.filter((row) => row.pass).length}/${own.length}`, toolCalls: average('toolCalls'), toolLoads: average('toolLoads'), failedToolCalls: average('failedToolCalls'), modelRequests: average('modelRequests'), inputTokens: average('inputTokens'), outputTokens: average('outputTokens'), seconds: Math.round(average('durationMs') / 1000), costCny: Math.round(own.reduce((sum, row) => sum + (row.costCny ?? 0), 0) / own.length * 1000) / 1000 }
  })
}

function saveResults(file, rows, surface) {
  fs.writeFileSync(file, `${JSON.stringify({ label, date: new Date().toISOString(), commit: execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(), limits: { maxInputTokens: MAX_INPUT_TOKENS, maxToolCalls: MAX_TOOL_CALLS }, totalCostCny: Math.round(rows.reduce((sum, row) => sum + (row.costCny ?? 0), 0) * 100) / 100, surface, summary: summarize(rows), rows }, null, 1)}\n`)
}

async function main() {
  if (args.includes('--static')) { console.log(JSON.stringify(staticSurface(), null, 2)); return }
  ensureFixtures()
  const directory = path.join(__dirname, 'results')
  fs.mkdirSync(directory, { recursive: true })
  const file = path.join(directory, `${label}.json`)
  // 同名结果已存在时接着跑：已有的任务与轮次不重跑。
  const rows = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).rows : []
  const surface = staticSurface()
  for (const task of TASKS.filter((item) => !only?.length || only.includes(item.id))) for (let index = 0; index < runs; index += 1) {
    if (rows.some((row) => row.task === task.id && row.run === index + 1)) continue
    const row = await runOnce(task, index)
    rows.push(row)
    saveResults(file, rows, surface)
    process.stderr.write(`${task.id}#${index + 1} ${row.pass ? '通过' : '未通过'} · ${row.status} · ${row.toolCalls ?? '-'} 次调用 · ${row.inputTokens ?? '-'} 输入 token · ¥${row.costCny ?? '-'} · ${Math.round((row.durationMs ?? 0) / 1000)}s\n`)
  }
  saveResults(file, rows, surface)
  console.table(summarize(rows))
  console.log(`结果已写入 ${path.relative(ROOT, file)}`)
}

if (require.main === module) main()
module.exports = { TASKS, measure, readChain, saveResults, staticSurface, label }
