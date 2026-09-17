/**
 * 外部连接的真实付费生成闭环核对。
 *
 * 默认只排练凭据、权限拒绝和既有媒体读取。明确指定 --paid 且已获授权时，
 * 使用真实应用资料目录完成一次生成；隔离资料目录不能证明真实凭据可解密。
 *
 *   未授权付费的连接 → 工具缺席 + 点名调用在派发前 PERMISSION_DENIED + 零供应商请求
 *   授权付费的连接   → create_visible_generation_task 真实提交 → get_generation_task 轮询到完成
 *                    → read_application_media 分块读回并与磁盘 SHA256 对齐
 *                    → add_generation_result_to_canvas 进画布并沿原引用回读
 *                    → 同 operationId 重传只拿回原回执，**不产生第二次供应商请求**
 *
 * 判据一律落在正式存储、操作账本与主进程结构化日志上，不看返回文本。
 *
 * **费用**：只提交清单里写明的那一次生成。失败就停下来，绝不循环重试烧钱。
 * **数据**：只创建并清理自己的夹具（一个画布工程、一条生成记录与其媒体文件、两条连接），
 * 用户既有工程、素材、设置一律不动。
 *
 * 用法：
 *   node scripts/mcp-paid-generation-check.cjs --probe   # 只验证凭据与未授权拒绝，零费用
 *   node scripts/mcp-paid-generation-check.cjs --paid    # 已获授权后，发起 1 次真实付费生成
 */
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { launchElectronApp, waitForApp } = require('./lib/electronLaunch.cjs')
const { authorizeMcpConnection, callTool, connectMcpClient, expectToolRefusal, operationEnvelope, waitMcpReady } = require('./lib/uiInspectionMcpClient.cjs')

const ROOT = path.resolve(__dirname, '..')
const MAIN_ENTRY = path.join(ROOT, 'out/main/index.cjs')
const FIXTURE_PROJECT_ID = `__mcp_paid_canvas_fixture_${randomUUID()}__`

/**
 * 付费清单（与任务文件 3.2 中的表格同一份）。按单价升序，只取第一个凭据可用的候选。
 * 每一项都必须能核定单价——核不出单价的模型一律不进这张表，更不允许运行时兜底挑选。
 */
const MODEL_CANDIDATES = [
  { modelId: 'kie-z-image', providerId: 'kie', unitPriceUsd: 0.004, params: { kieZImageAspectRatio: '1:1' } },
  { modelId: 'fal-z-image-turbo', providerId: 'fal', unitPriceUsd: 0.005, params: {} },
  { modelId: 'apimart-z-image-turbo', providerId: 'apimart', unitPriceUsd: 0.01, params: { apimartZImageTurboAspectRatio: '1:1', apimartZImageTurboResolution: '1K', apimartZImageTurboPromptExtend: false } },
]
/** 总费用上限（人民币）。预计实际支出 ≈ $0.004（约 ¥0.03），留足一位数量级的安全边界。 */
const COST_CEILING_CNY = 1
const USD_TO_CNY = 7.3

const PROMPT = '一只安静坐在木质窗台上的白色陶瓷猫摆件，柔和晨光，浅景深'

function parseArgs(argv) {
  const options = { outDir: path.join('.mcp-paid', `run-${Date.now()}`), probe: true }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--probe') options.probe = true
    else if (token === '--paid') options.probe = false
    else if (token === '--out') { options.outDir = argv[index + 1]; index += 1 }
    else if (token.startsWith('--out=')) options.outDir = token.slice('--out='.length)
    else throw new Error(`未知参数：${token}`)
  }
  return options
}

/**
 * 供应商请求的唯一计数口径：主进程在真正把请求交给 SDK 之前写的结构化日志。
 * 通过正式查询接口限定本轮时间、事件和条数；超限直接失败，不把截断结果当成零重复。
 */
async function countProviderRequests(page, afterTimestamp, { requestId = null } = {}) {
  const counts = { built: 0, started: 0 }
  const dates = [...new Set([afterTimestamp.slice(0, 10), new Date().toISOString().slice(0, 10)])]
  for (const [key, event] of [['built', 'generation.runtime.request_json'], ['started', 'ai_runtime.generate.start']]) {
    for (const date of dates) {
      const result = await page.evaluate((params) => window.henjiNative.logging.queryLogEvents(params), {
        date, afterTimestamp, source: 'backend', level: 'info', keyword: event, limit: 100,
        ...(requestId ? { requestId } : {}),
      })
      assert.equal(result.hasMore, false, '供应商请求日志超出本轮查询上限，不能证明请求次数')
      counts[key] += result.events.filter((entry) => entry.event === event).length
    }
  }
  return counts
}

const readHistoryCount = (page) => page.evaluate(async () => (await window.henjiNative.db.select('SELECT COUNT(*) AS total FROM history'))[0].total)

/**
 * 生成结果的 `history.file_path` 相对的是**应用数据根目录**，不是脚本的工作目录，也不是
 * `paths.appLocalDataDir()`（后者只到 `…/com.henji.ai`，少一层 `Henji-AI`）。这里按主进程
 * `getDataRootDir()` 的同一份规则解析：优先用户自定义数据目录，否则基准目录加 `Henji-AI`。
 */
async function resolveDataRootDir(page) {
  const custom = (await page.evaluate(() => window.henjiNative.db.select('SELECT value FROM settings WHERE key = ?', ['custom_data_directory'])))[0]
  const trimmed = typeof custom?.value === 'string' ? custom.value.trim() : ''
  if (trimmed) return trimmed
  return path.join(await page.evaluate(() => window.henjiNative.paths.appLocalDataDir()), 'Henji-AI')
}

const toAbsoluteMediaPath = (dataRoot, value) => (path.isAbsolute(value) ? value : path.resolve(dataRoot, value))

async function readAllMedia(client, ref) {
  const chunks = []
  let offset = 0
  let mimeType = null
  let totalBytes = 0
  // 刻意用远小于 256 KiB 的块，逼出 offset/eof 续读协议本身；一次读完证明不了分块。
  for (let guard = 0; guard < 4096; guard += 1) {
    const chunk = await callTool(client, 'read_application_media', { ref, offset, length: 4096 })
    mimeType = chunk.mimeType
    totalBytes = chunk.totalBytes
    const bytes = Buffer.from(chunk.base64, 'base64')
    chunks.push(bytes)
    assert.equal(chunk.offset, offset, `分块起点与请求不一致：${JSON.stringify({ ...chunk, base64: undefined })}`)
    assert.equal(chunk.byteLength, bytes.length, '声明长度与实际字节数不一致')
    offset += chunk.byteLength
    if (chunk.eof) return { bytes: Buffer.concat(chunks), mimeType, totalBytes }
    assert.ok(chunk.byteLength > 0, '未到 eof 却返回空块，续读会死循环')
  }
  throw new Error('分块读取没有在限定次数内到达 eof')
}

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const outDir = path.isAbsolute(options.outDir) ? options.outDir : path.resolve(ROOT, options.outDir)
  fs.mkdirSync(outDir, { recursive: true })
  const nonce = `n${Math.random().toString(36).slice(2, 8)}`
  const evidence = {
    mode: options.probe ? 'probe' : 'paid',
    passed: false,
    startedAt: new Date().toISOString(),
    costCeilingCny: COST_CEILING_CNY,
    userDataDir: 'real',
  }
  const port = 43890 + Math.floor(Math.random() * 30)

  /*
   * `appPath: ROOT` 不是可有可无的写法。直接 `electron out/main/index.cjs` 时 Electron 解析
   * 不到 package.json，userData 退回 `…/Roaming/Electron`，safeStorage 换了一把密钥，
   * 用户真实的供应商凭据**全部解不开**——上一轮「本机 9 条凭据全坏」的误判正是这么来的。
   * 付费闭环必须用应用自己的身份与 userData 启动。
   */
  const app = await launchElectronApp({ mainEntry: MAIN_ENTRY, appPath: ROOT, cwd: ROOT, useElectronApi: true, extraArgs: ['--dev-skip-onboarding'] })
  const { page } = app
  const created = { connections: [], historyId: null, mediaPaths: [], project: false }
  let restoreMcp = null
  try {
    await waitForApp(page)

    // ——— 0. 记下用户原有的对外服务状态，收尾必须原样还回去 ———
    const initialStatus = await page.evaluate(() => window.henjiNative.mcp.status())
    restoreMcp = { enabled: initialStatus.enabled === true, port: initialStatus.port }
    evidence.initialService = { enabled: restoreMcp.enabled, port: restoreMcp.port, connections: initialStatus.connections.length }

    // ——— 1. 真实凭据状态：这一步就是上一轮误判的正面推翻 ———
    const keyStatus = await page.evaluate(() => window.henjiNative.ai.getProviderKeyStatus())
    evidence.providerKeys = keyStatus.map((item) => ({ providerId: item.providerId, configured: item.configured === true }))
    const configured = new Set(evidence.providerKeys.filter((item) => item.configured).map((item) => item.providerId))
    const chosen = MODEL_CANDIDATES.find((candidate) => configured.has(candidate.providerId))
    evidence.configuredProviders = [...configured]
    if (!chosen) throw new Error(`付费清单里的候选供应商全部未配置：${MODEL_CANDIDATES.map((item) => item.providerId).join('、')}；实际可用 ${[...configured].join('、') || '（无）'}`)
    evidence.model = { ...chosen, estimatedCny: Number((chosen.unitPriceUsd * USD_TO_CNY).toFixed(4)) }
    assert.ok(evidence.model.estimatedCny <= COST_CEILING_CNY, `单次预估 ¥${evidence.model.estimatedCny} 超出总费用上限 ¥${COST_CEILING_CNY}`)
    console.log(`[MCP 付费] 可用供应商：${[...configured].join('、')}；选用 ${chosen.modelId}（$${chosen.unitPriceUsd}/张 ≈ ¥${evidence.model.estimatedCny}）`)

    const historyBefore = await readHistoryCount(page)
    const providerBefore = await countProviderRequests(page, evidence.startedAt)
    evidence.baseline = { historyCount: historyBefore, providerRequests: providerBefore }

    // ——— 2. 未授权付费的连接：工具缺席 + 点名调用在派发前被拒 + 零供应商请求 ———
    const unpaid = await authorizeMcpConnection(page, { name: `付费验收-未授权-${nonce}`, allowWrites: true })
    created.connections.push(unpaid.id)
    await page.evaluate(async (targetPort) => {
      const state = await window.henjiNative.mcp.status()
      if (state.port !== targetPort) {
        await window.henjiNative.mcp.configure({ enabled: false, port: state.port })
        await window.henjiNative.mcp.configure({ enabled: true, port: targetPort })
      }
    }, port)
    await waitMcpReady(page)
    const config = (identity) => ({ url: `http://127.0.0.1:${port}/mcp`, headers: identity.config.headers })
    const unpaidClient = await connectMcpClient(config(unpaid), 'Henji paid unpaid')
    try {
      const tools = (await unpaidClient.listTools()).tools.map((tool) => tool.name)
      assert.equal(tools.includes('create_visible_generation_task'), false, '未授权付费的连接看到了发起生成的工具')
      const contract = await callTool(unpaidClient, 'describe_application_contract', { domains: ['generation'] })
      assert.equal(contract.data.access.hiddenTools.find((item) => item.name === 'create_visible_generation_task')?.tier, 'paid',
        `缺席工具必须说得出缺哪一档：${JSON.stringify(contract.data.access.hiddenTools)}`)
      // 缺席不等于拒绝：点名调用必须在派发前拒绝，而不是"清单里没有所以调不到"。
      const modelRef = { kind: 'generation.model', id: chosen.modelId }
      const modelRead = await callTool(unpaidClient, 'read_application_entity', { ref: modelRef, propertyIds: [] })
      const refusal = await expectToolRefusal(unpaidClient, 'create_visible_generation_task', operationEnvelope([modelRead], {
        modelId: chosen.modelId, prompt: PROMPT, mediaType: 'image', params: chosen.params,
      }))
      assert.ok(/PERMISSION_DENIED/.test(refusal), `未授权付费的点名调用没有被拒绝：${refusal}`)
      assert.ok(/付费/.test(refusal), `拒绝没有说清缺的是付费授权：${refusal}`)
      evidence.unpaid = { toolHidden: true, refusal }
    } finally { await unpaidClient.close().catch(() => undefined) }
    const providerAfterUnpaid = await countProviderRequests(page, evidence.startedAt)
    assert.deepEqual(providerAfterUnpaid, providerBefore, '未授权付费的连接期间发生了供应商请求')
    assert.equal(await readHistoryCount(page), historyBefore, '未授权付费的连接期间生成历史发生了变化')
    evidence.unpaid.providerRequests = providerAfterUnpaid

    if (options.probe) {
      /*
       * 付费之后的每一步都要能在花钱之前先排练一遍。
       *
       * 这不是谨慎过头：本轮已经为两处**与付费无关**的脚本缺陷各烧掉一次真实生成
       * （落盘路径相对的是应用数据根目录，既不是工作目录也不是 `appLocalDataDir()`）。
       * 排练用用户既有的一条成功生成记录，只读，不写、不删、不改。
       */
      const dataRoot = await resolveDataRootDir(page)
      const sample = (await page.evaluate(() => window.henjiNative.db.select(
        "SELECT id, file_path FROM history WHERE file_path IS NOT NULL AND file_path <> '' AND (status = 'success' OR status = 'completed') AND type = 'image' ORDER BY created_at DESC LIMIT 1")))[0]
      evidence.rehearsal = { dataRoot, sampleFound: Boolean(sample) }
      if (sample) {
        const diskPath = toAbsoluteMediaPath(dataRoot, String(sample.file_path).split('|||')[0])
        evidence.rehearsal.diskPath = diskPath
        if (fs.existsSync(diskPath)) {
          const probeClient = await connectMcpClient(config(unpaid), 'Henji paid rehearsal')
          try {
            const media = await readAllMedia(probeClient, { kind: 'generation.result', id: sample.id })
            const diskBytes = await fsp.readFile(diskPath)
            assert.equal(media.totalBytes, diskBytes.length, '排练：声明总长度与磁盘文件不符')
            assert.equal(sha256(media.bytes), sha256(diskBytes), '排练：分块读回的字节与磁盘文件不是同一份内容')
            evidence.rehearsal.mediaMatches = true
          } finally { await probeClient.close().catch(() => undefined) }
        } else evidence.rehearsal.diskMissing = true
      }
      evidence.probeOnly = '只验证凭据可用、未授权拒绝与落盘路径解析，未发起任何付费生成'
      console.log(`[MCP 付费] --probe：凭据与未授权拒绝已核对；媒体排练${evidence.rehearsal.mediaMatches ? '通过' : '未取证（无可读取的成功样本）'}，未发起供应商请求。`)
    } else {
      // ——— 3. 授权付费的连接：真实提交 ———
      const paid = await authorizeMcpConnection(page, { name: `付费验收-已授权-${nonce}`, allowWrites: true, allowPaid: true })
      created.connections.push(paid.id)
      await waitMcpReady(page)
      const client = await connectMcpClient(config(paid), 'Henji paid')
      try {
        const tools = (await client.listTools()).tools.map((tool) => tool.name)
        assert.ok(tools.includes('create_visible_generation_task'), '授权付费的连接没有拿到发起生成的工具')

        // 提交前先过参数校验；这一步是只读的，不产生费用。
        const preparation = await callTool(client, 'prepare_generation_task', {
          modelId: chosen.modelId, prompt: PROMPT, mediaType: 'image', params: chosen.params,
        })
        assert.equal(preparation.data.preparation.providerId, chosen.providerId, JSON.stringify(preparation.data.preparation))
        evidence.preparation = { modelId: preparation.data.preparation.modelId, providerId: preparation.data.preparation.providerId }

        const modelRef = { kind: 'generation.model', id: chosen.modelId }
        const modelRead = await callTool(client, 'read_application_entity', { ref: modelRef, propertyIds: [] })
        const submission = operationEnvelope([modelRead], {
          modelId: chosen.modelId, prompt: PROMPT, mediaType: 'image', params: chosen.params,
        })
        console.log(`[MCP 付费] 即将发起唯一一次真实生成，operationId=${submission.operationId}`)
        const submitted = await callTool(client, 'create_visible_generation_task', submission)
        assert.equal(submitted.executionState, 'completed', JSON.stringify(submitted))
        const taskId = submitted.result.data.taskId
        created.historyId = taskId
        evidence.submission = { operationId: submission.operationId, taskId, executionState: submitted.executionState, status: submitted.result.data.status }
        assert.equal(submitted.result.data.status, 'submitted', JSON.stringify(submitted.result.data))

        // ——— 4. 轮询到完成。只查询，不重发；失败直接停下来分析。 ———
        const deadline = Date.now() + 240_000
        let task = null
        while (Date.now() < deadline) {
          task = (await callTool(client, 'get_generation_task', { taskId })).data.task
          if (['success', 'completed', 'error', 'failed', 'cancelled', 'canceled'].includes(task.normalizedStatus ?? task.status)) break
          await page.waitForTimeout(2000)
        }
        evidence.task = { status: task?.status, normalizedStatus: task?.normalizedStatus, resultAvailable: task?.resultAvailable === true, waitingExternal: task?.waitingExternal === true }
        assert.ok(task, '轮询没有拿到任何任务快照')
        assert.ok(['success', 'completed'].includes(task.normalizedStatus ?? task.status),
          `生成未成功，停止后续步骤以免重复扣费：${JSON.stringify({ status: task.status, error: task.errorMessage ?? task.error ?? null })}`)
        assert.ok(task.resultRef && task.resultRef.kind === 'generation.result', `完成的任务必须给出稳定结果引用：${JSON.stringify(task.resultRef)}`)

        // 供应商请求计数：这一次生成恰好一次请求。
        const afterSubmit = await countProviderRequests(page, evidence.startedAt, { requestId: taskId })
        assert.equal(afterSubmit.built, 1, `本次生成的供应商请求次数不是 1：${JSON.stringify(afterSubmit)}`)
        evidence.providerRequestsAfterSubmit = afterSubmit

        // ——— 5. 媒体真实获取：分块读回并与磁盘文件逐字节对齐 ———
        const row = (await page.evaluate((id) => window.henjiNative.db.select('SELECT file_path FROM history WHERE id = ?', [id]), taskId))[0]
        assert.ok(row?.file_path, '生成结果没有落盘，无法核对媒体字节')
        const dataRoot = await resolveDataRootDir(page)
        created.mediaPaths = String(row.file_path).split('|||').map((value) => toAbsoluteMediaPath(dataRoot, value))
        const diskBytes = await fsp.readFile(created.mediaPaths[0])
        const media = await readAllMedia(client, task.resultRef)
        assert.equal(media.totalBytes, diskBytes.length, '声明总长度与磁盘文件不符')
        assert.equal(sha256(media.bytes), sha256(diskBytes), '分块读回的字节与磁盘文件不是同一份内容')
        assert.ok(/^image\//.test(media.mimeType), `结果媒体类型不是图片：${media.mimeType}`)
        evidence.media = { mimeType: media.mimeType, totalBytes: media.totalBytes, sha256: sha256(media.bytes), chunkBytes: 4096 }

        // ——— 6. 进画布：沿原引用回读，媒体在画布节点上仍是同一份字节 ———
        await page.evaluate(async ({ projectId }) => {
          const now = Date.now()
          await window.henjiNative.storyboardProjects.upsertProjectRecord({
            id: projectId, name: 'MCP付费验收夹具', createdAt: now, updatedAt: now, nodeCount: 0,
            nodesJson: '[]', edgesJson: '[]', viewportJson: JSON.stringify({ x: 0, y: 0, zoom: 1 }),
            historyJson: JSON.stringify({ past: [], future: [], imagePool: [] }),
          })
        }, { projectId: FIXTURE_PROJECT_ID })
        created.project = true
        /*
         * 进画布这一步单独兜住失败：**重传不二次扣费**是本次付费验收最贵也最重要的一条断言，
         * 不能因为画布环节出问题就拿不到它，否则修完又得再烧一次钱。失败原样记进证据，
         * 收尾时照样让整个脚本失败——兜的是执行顺序，不是判据。
         */
        let canvasFailure = null
        try {
          const projectRef = { kind: 'canvas.project', id: FIXTURE_PROJECT_ID }
          const projectRead = await callTool(client, 'read_application_entity', { ref: projectRef, propertyIds: ['canvas.project.name'] })
          const resultRead = await callTool(client, 'read_application_entity', { ref: task.resultRef, propertyIds: [] })
          const placed = await callTool(client, 'add_generation_result_to_canvas', operationEnvelope([projectRead, resultRead], {
            projectId: FIXTURE_PROJECT_ID, resultRef: { kind: 'generation.result', id: task.resultRef.id }, placement: { mode: 'absolute', x: 0, y: 0 },
          }))
          assert.equal(placed.executionState, 'completed', JSON.stringify(placed))
          const nodeRef = placed.result.data.nodeRef
          evidence.canvas = { nodeRef, mediaType: placed.result.data.mediaType, verified: placed.result.data.verification?.verified === true }
          const persisted = await page.evaluate((projectId) => window.henjiNative.storyboardProjects.getProjectRecord(projectId), FIXTURE_PROJECT_ID)
          const nodes = JSON.parse(persisted.nodesJson)
          assert.equal(nodes.length, 1, `画布工程里应恰好一个结果节点，实际 ${nodes.length} 个`)
          assert.equal(`${FIXTURE_PROJECT_ID}:${nodes[0].id}`, nodeRef.id, '回读到的节点与返回的稳定引用不一致')
          const nodeMedia = await readAllMedia(client, nodeRef)
          assert.equal(sha256(nodeMedia.bytes), sha256(diskBytes), '沿画布节点引用读回的媒体与原结果不是同一份')
        } catch (error) {
          canvasFailure = error instanceof Error ? error.message : String(error)
          evidence.canvas = { failed: canvasFailure }
          console.error(`[MCP 付费] 进画布环节失败，先取完重传证据再报错：${canvasFailure}`)
        }

        // ——— 7. 同 operationId 重传：只拿回原回执，绝不二次扣费 ———
        const replay = await client.callTool({ name: 'create_visible_generation_task', arguments: submission })
        assert.equal(replay.isError, false, `重传应返回原回执，实际失败：${JSON.stringify(replay)}`)
        assert.equal(replay.structuredContent.result.data.taskId, taskId, '重传返回了不同的任务标识，说明又提交了一次')
        const afterReplay = await countProviderRequests(page, evidence.startedAt, { requestId: taskId })
        assert.deepEqual(afterReplay, afterSubmit, `同 operationId 重传产生了第二次供应商请求：${JSON.stringify({ afterSubmit, afterReplay })}`)
        assert.equal(await readHistoryCount(page), historyBefore + 1, '重传后生成历史多出了额外记录')
        const readLedger = async () => (await page.evaluate((id) => window.henjiNative.db.select(
          'SELECT COUNT(*) AS total, MAX(phase) AS phase, MAX(created_at) AS createdAt FROM generation_submissions WHERE request_id = ?', [id]), taskId))[0]
        const ledger = await readLedger()
        assert.equal(ledger.total, 1, `生成提交账本对同一请求留下了 ${ledger.total} 条记录`)
        evidence.replay = { taskId: replay.structuredContent.result.data.taskId, providerRequests: afterReplay, ledgerRows: ledger.total, ledgerPhase: ledger.phase }

        /*
         * 再直接敲一次主进程的生成提交账本本身（绕过 MCP 操作账本的短路）：
         * 同一 requestId 无论拿回原回执还是被拒绝，账本行必须还是原来那一条，
         * 供应商请求数也不得增加——这才是"不会二次扣费"的判据，返回文本不是。
         */
        const direct = await page.evaluate(async ({ id, modelId, prompt, params }) => {
          try {
            const response = await window.henjiNative.ai.generate({ requestId: id, modelId, params: { prompt, ...params } })
            return { outcome: 'receipt', taskId: response?.taskId ?? null, status: response?.status ?? null }
          } catch (error) { return { outcome: 'refused', message: String(error?.message ?? error) } }
        }, { id: taskId, modelId: chosen.modelId, prompt: PROMPT, params: chosen.params })
        const afterDirect = await countProviderRequests(page, evidence.startedAt, { requestId: taskId })
        const ledgerAfterDirect = await readLedger()
        assert.deepEqual(afterDirect, afterSubmit, `直接重放同一 requestId 产生了第二次供应商请求：${JSON.stringify({ afterSubmit, afterDirect, direct })}`)
        assert.deepEqual(ledgerAfterDirect, ledger, `直接重放改动了生成提交账本：${JSON.stringify({ ledger, ledgerAfterDirect, direct })}`)
        evidence.submissionLedgerReplay = { ...direct, providerRequests: afterDirect, ledgerRows: ledgerAfterDirect.total }

        // 单价乘请求数仅为估算，不是供应商账单证明。
        evidence.estimatedSpendUsd = chosen.unitPriceUsd
        evidence.estimatedSpendCny = Number((chosen.unitPriceUsd * USD_TO_CNY).toFixed(4))
        if (canvasFailure) throw new Error(`进画布环节未通过（重传证据已取齐）：${canvasFailure}`)
      } finally { await client.close().catch(() => undefined) }
    }
    evidence.passed = true
  } catch (error) {
    evidence.failure = error instanceof Error ? error.message : String(error)
    throw error
  } finally {
    // ——— 清理：只删自己建的东西，用户既有数据一律不动 ———
    const cleanup = { project: false, history: false, media: [], connections: [], errors: [] }
    const attempt = async (name, work) => {
      try { await work() } catch (error) {
        cleanup.errors.push({ step: name, message: error instanceof Error ? error.message : String(error) })
      }
    }
    if (created.project) {
      await attempt('project', async () => {
        await page.evaluate((projectId) => window.henjiNative.storyboardProjects.deleteProjectRecord(projectId), FIXTURE_PROJECT_ID)
        cleanup.project = true
      })
    }
    if (created.historyId) {
      await attempt('history', async () => {
        // 未拿到终态时保留任务与账本，避免清掉仍在运行或结果未知的付费请求。
        if (!['success', 'completed', 'failed', 'error', 'cancelled'].includes(evidence.task?.normalizedStatus ?? evidence.task?.status)) {
          throw new Error('生成终态未确认，保留该任务与账本供恢复核对')
        }
        await page.evaluate((id) => window.henjiNative.db.execute('DELETE FROM history WHERE id = ?', [id]), created.historyId)
        await page.evaluate((id) => window.henjiNative.db.execute('DELETE FROM generation_submissions WHERE request_id = ?', [id]), created.historyId)
        cleanup.history = true
      })
    }
    for (const media of created.mediaPaths) {
      if (!media || /^https?:/i.test(media)) continue
      await attempt('media', async () => { await fsp.rm(media, { force: true }); cleanup.media.push(media) })
    }
    for (const id of created.connections) {
      await attempt('connection', async () => {
        await page.evaluate((value) => window.henjiNative.mcp.revoke({ id: value }), id)
        cleanup.connections.push(id)
      })
    }
    if (restoreMcp) {
      await attempt('restore-service', () => page.evaluate(async (target) => { await window.henjiNative.mcp.configure({ enabled: target.enabled, port: target.port }) }, restoreMcp))
    }
    evidence.cleanup = cleanup
    if (cleanup.errors.length) evidence.passed = false
    evidence.finishedAt = new Date().toISOString()
    fs.writeFileSync(path.join(outDir, 'paid.json'), JSON.stringify(evidence, null, 2), 'utf8')
    await app.close().catch(() => undefined)
    if (cleanup.errors.length && !evidence.failure) throw new Error(`验收清理未完成：${JSON.stringify(cleanup.errors)}`)
  }

  console.log(JSON.stringify(evidence, null, 2))
  console.log(`\n✓ ${options.probe ? '非付费排练' : '真实付费生成闭环'}核对通过，证据：${path.join(outDir, 'paid.json')}`)
}

main().catch((error) => {
  console.error(`FAILED: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  process.exitCode = 1
})
