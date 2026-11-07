#!/usr/bin/env node
'use strict'

/**
 * 模型真实请求验收的驱动脚本（只在开发版上用）。
 *
 * 连上开着调试端口的开发版（HENJI_ELECTRON_REMOTE_DEBUGGING_PORT=9333），逐条执行用例：
 * 准备参数 → 估价闸门（单条上限、累计上限）→ 应用弹付费确认就一律拒绝（只拒不批，不放宽付费策略）
 * → 走正式生成链路并续查到结果 → 读成品校验尺寸、时长、透明、音轨 → 记录追加到 JSONL。
 * 已完成的用例按 id 跳过，可随时中断续跑；requestId 固定为 real-<id>，同一标识重复提交时主进程返回原结果，不会重复计费。
 *
 * 用法：
 *   node scripts/real-request-acceptance.cjs --cases <cases.json> --out <runs.jsonl> --media <素材目录>
 *     [--only id1,id2] [--per-call 2] [--cap 14] [--parallel 1]
 * 用例格式见 docs/task/模型真实请求验收/ 下的 cases-*.json。
 */

const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index > 0 ? process.argv[index + 1] : fallback
}

const casesPath = arg('cases')
const outPath = arg('out')
const mediaDir = arg('media', '')
const only = new Set((arg('only', '') || '').split(',').map(item => item.trim()).filter(Boolean))
const perCallCap = Number(arg('per-call', '2'))
const totalCap = Number(arg('cap', '14'))
const parallel = Math.max(1, Number(arg('parallel', '1')))
if (!casesPath || !outPath) {
  console.error('需要 --cases 与 --out')
  process.exit(1)
}

const cases = JSON.parse(fs.readFileSync(casesPath, 'utf8'))
const previous = fs.existsSync(outPath)
  ? fs.readFileSync(outPath, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
  : []
const finished = new Set(previous.filter(record => record.status === 'passed' || record.status === 'failed').map(record => record.id))
// 累计花费按估价算：实扣在收工对账时再补。跳过的不计。
let spent = previous.filter(record => record.status === 'passed' || record.status === 'failed').reduce((sum, record) => sum + (record.estimatedCny || 0), 0)

/** 在渲染层执行一条用例；所有判断都走应用自己的模块，不另写一套。 */
async function runCaseInPage(input) {
  const { mediaDir, perCallCap, remaining, source } = input
  let c = input.c
  const join = (file) => file.includes(':') || file.startsWith('/') ? file : `${mediaDir}/${file}`
  const { registry } = await import('/src/core/ModelRegistry.ts')
  const prep = await import('/src/features/generation/application/generationPreparationService.ts')
  const runner = await import('/src/features/developer/modelTestRunner.ts')
  const { useAlertDialogStore } = await import('/src/stores/alertDialogStore.ts')
  const { readImageInfo } = await import('/src/commands/image.ts')
  const { readVideoInfo } = await import('/src/commands/video.ts')

  // 续接用例：拿源结果当时提交的参数和平台引用，按应用自己的续接规则换到目标模型与参数。
  if (c.continueFrom) {
    if (!source?.continuations) return { status: 'skipped', reason: `源用例 ${c.continueFrom.caseId} 没有可续接的结果` }
    const continuations = await import('/src/core/services/generationContinuations.ts')
    const stored = continuations.withStoredContinuations(source.params, source.continuations)
    const prepared = continuations.prepareGenerationContinuation(source.modelId, stored, c.continueFrom.continuation)
    if (!prepared) return { status: 'skipped', reason: `源结果不能做 ${c.continueFrom.continuation}` }
    c = { ...c, modelId: prepared.targetModelId, params: { ...prepared.params, ...(c.params ?? {}) } }
  }
  const model = registry.getModel(c.modelId)
  if (!model) return { status: 'skipped', reason: '模型没有注册' }
  const media = {
    images: (c.media?.images ?? []).map(join),
    videos: (c.media?.videos ?? []).map(join),
    audios: (c.media?.audios ?? []).map(join),
  }
  const prompt = c.prompt ?? '一只橘猫坐在洒满阳光的窗台上，电影感'
  // 参数里引用素材写成 @media/<文件名>（如蒙版），换成素材目录里的绝对路径。
  const resolveMedia = (value) => typeof value === 'string' && value.startsWith('@media/') ? join(value.slice(7))
    : Array.isArray(value) ? value.map(resolveMedia) : value
  const params = Object.fromEntries(Object.entries(c.params ?? {}).map(([key, value]) => [key, resolveMedia(value)]))
  const supplied = {
    ...registry.getDefaultValues(c.modelId),
    ...params,
    uploadedFilePaths: media.images, images: media.images,
    uploadedVideoFilePaths: media.videos, videos: media.videos,
    uploadedAudioFilePaths: media.audios,
  }
  let options = supplied
  if (registry.getDiscoverableModel(c.modelId)) {
    try {
      options = prep.prepareGenerationTask({ modelId: c.modelId, prompt, mediaType: model.meta.type, options: supplied }).options
    } catch (error) {
      return { status: 'failed', stage: 'prepare', error: String(error?.message ?? error), errorDetails: error?.details ?? undefined }
    }
  }
  // 用例设了界面在当前条件下隐藏的参数（例如有参考图时比例跟随素材），记下来：它不会生效，期望也不该按它核对。
  const { isParamVisible } = await import('/src/components/params/paramVisibility.ts')
  const { LinkageEngine } = await import('/src/core/linkage/index.ts')
  const engine = model.linkages?.length ? new LinkageEngine(model.linkages) : null
  const hiddenParams = registry.getSchema(c.modelId).filter((param) => param.id in params && !isParamVisible(param, options, engine)).map((param) => param.id)
  const estimate = await prep.estimateGenerationPrice(model, { ...options, prompt, text: prompt })
  const estimatedCny = estimate.comparableCnyAmount
  if (estimatedCny === null || estimatedCny === undefined) return { status: 'skipped', reason: '估价为空，付费策略会询问', estimate }
  if (estimatedCny > perCallCap) return { status: 'skipped', reason: `估价 ¥${estimatedCny.toFixed(3)} 超过单条上限`, estimatedCny }
  if (estimatedCny > remaining) return { status: 'skipped', reason: `估价 ¥${estimatedCny.toFixed(3)} 超过剩余预算 ¥${remaining.toFixed(3)}`, estimatedCny }

  // 应用要求确认（超出单次或每日额度）时一律拒绝：不替用户放宽付费策略。
  let declined = false
  const unsubscribe = useAlertDialogStore.subscribe((state) => {
    if (state.queue[0]?.confirmation) { declined = true; state.dismissCurrent() }
  })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), c.timeoutMs ?? 15 * 60_000)
  const startedAt = Date.now()
  try {
    const result = await runner.runGenerationTest({
      modelId: c.modelId, prompt, params, media, signal: controller.signal, requestId: `real-${c.id}`,
    })
    const files = []
    for (const filePath of result.filePaths) {
      const extension = filePath.split('.').pop()?.toLowerCase() ?? ''
      try {
        if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(extension)) files.push({ filePath, kind: 'image', ...(await readImageInfo(filePath)) })
        else files.push({ filePath, kind: ['mp4', 'mov', 'webm'].includes(extension) ? 'video' : 'audio', ...(await readVideoInfo(filePath)) })
      } catch (error) {
        files.push({ filePath, kind: 'unknown', error: String(error?.message ?? error) })
      }
    }
    const metadata = result.metadata ?? {}
    return {
      status: 'done', estimatedCny, hiddenParams, elapsedMs: Date.now() - startedAt, requestId: result.requestId, taskId: result.taskId ?? null,
      params: result.params, files, urls: result.urls,
      continuations: result.continuations ?? null,
      cost: { kieCredits: metadata?.data?.creditsConsumed ?? metadata?.creditsConsumed ?? null, apimartCost: metadata?.data?.cost ?? metadata?.cost ?? null, usage: metadata?.usage ?? null },
    }
  } catch (error) {
    return { status: declined ? 'skipped' : 'failed', reason: declined ? '应用要求确认，已拒绝，未发送' : undefined, stage: 'run', estimatedCny: declined ? 0 : estimatedCny, elapsedMs: Date.now() - startedAt, error: String(error?.message ?? error), errorDetails: error?.details ?? undefined }
  } finally {
    unsubscribe()
    clearTimeout(timer)
  }
}

/** 按用例期望核对成品；只核对能从文件读出的事实。 */
function verify(c, outcome) {
  const expect = c.expect ?? {}
  const problems = []
  const files = outcome.files ?? []
  if (!files.length) problems.push('没有结果文件')
  for (const file of files) if (file.error) problems.push(`读不出 ${path.basename(file.filePath)}：${file.error}`)
  if (expect.count !== undefined && files.length !== expect.count) problems.push(`文件数 ${files.length}，期望 ${expect.count}`)
  for (const file of files.filter(item => !item.error)) {
    if (expect.kind && file.kind !== expect.kind) problems.push(`类型 ${file.kind}，期望 ${expect.kind}`)
    const aspectHidden = (outcome.hiddenParams ?? []).some(id => /AspectRatio/i.test(id))
    if (expect.aspect && !aspectHidden && file.width && file.height) {
      const [w, h] = expect.aspect.split(':').map(Number)
      const ratio = file.width / file.height
      if (Math.abs(ratio - w / h) / (w / h) > 0.03) problems.push(`比例 ${file.width}x${file.height}，期望 ${expect.aspect}`)
    }
    if (expect.seconds !== undefined && Math.abs((file.durationSeconds ?? 0) - expect.seconds) > (expect.secondsTolerance ?? 0.6)) problems.push(`时长 ${file.durationSeconds}，期望 ${expect.seconds}`)
    if (expect.shortSide && file.width && file.height && Math.abs(Math.min(file.width, file.height) - expect.shortSide) > 16) problems.push(`短边 ${Math.min(file.width, file.height)}，期望 ${expect.shortSide}`)
    if (expect.hasAudio !== undefined && file.hasAudio !== expect.hasAudio) problems.push(`音轨 ${file.hasAudio}，期望 ${expect.hasAudio}`)
    if (expect.transparent && !file.hasAlpha) problems.push('没有透明通道')
    if (file.kind === 'audio' && !(file.durationSeconds > 0.5)) problems.push(`音频时长 ${file.durationSeconds}`)
  }
  return problems
}

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333')
  const page = browser.contexts().flatMap(context => context.pages()).find(item => !item.url().startsWith('devtools'))
  if (!page) throw new Error('找不到开发版窗口')
  const pending = cases.filter(c => !finished.has(c.id) && (!only.size || only.has(c.id)))
  console.log(`[real] 待跑 ${pending.length} 条，已花约 ¥${spent.toFixed(3)}，上限 ¥${totalCap}`)
  const queue = [...pending]
  const done = []
  const worker = async () => {
    while (queue.length) {
      const c = queue.shift()
      const remaining = totalCap - spent
      const sourceRecord = c.continueFrom ? previous.concat(done).find(record => record.id === c.continueFrom.caseId && record.continuations) : undefined
      const source = sourceRecord ? { modelId: sourceRecord.modelId, params: sourceRecord.params, continuations: sourceRecord.continuations } : undefined
      const outcome = await page.evaluate(runCaseInPage, { c, mediaDir: mediaDir.replace(/\\/g, '/'), perCallCap, remaining, source })
      let status = outcome.status
      let problems = []
      if (status === 'done') {
        problems = verify(c, outcome)
        status = problems.length ? 'failed' : 'passed'
      }
      if (status === 'passed' || status === 'failed') spent += outcome.estimatedCny || 0
      const record = { id: c.id, tier: c.tier, modelId: c.modelId, at: new Date().toISOString(), ...outcome, status, problems }
      fs.appendFileSync(outPath, `${JSON.stringify(record)}\n`)
      done.push(record)
      const note = status === 'passed' ? '' : ` ${outcome.reason ?? ''}${outcome.error ? ` ${outcome.error}` : ''}${problems.length ? ` ${problems.join('；')}` : ''}`
      console.log(`[real] ${c.id} ${c.modelId} ${status} ¥${(outcome.estimatedCny ?? 0).toFixed(3)} 累计 ¥${spent.toFixed(3)}${note}`)
    }
  }
  await Promise.all(Array.from({ length: parallel }, worker))
  await browser.close()
}

main().catch(error => { console.error(error); process.exit(1) })
