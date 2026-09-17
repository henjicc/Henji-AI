/**
 * 跨域媒体链路的真实付费闭环：图片生成 → 裁剪编辑 → 用编辑产物当首帧图生视频。
 *
 * 非付费的 Reality 场景（`mcp-media-chain`）已经证明了链路的**内部接线**：交给供应商的那张图
 * 确实是裁剪后的编辑产物。这里买的是它证明不了的那一段——**真实供应商会不会接受这张图**：
 * 编辑产物能否被正确编码上传、真实异步视频任务能否轮询到终态、结果能否落盘并挂上画布节点。
 *
 * **费用清单（执行前写定，脚本内常量与之逐项对应）**：
 *   图片 `kie-z-image` 1 张 ................................. $0.004
 *   视频 `kie-seedance-1.5-pro` 480p / 4 秒 / 无音频 ......... $0.035（$0.00875 每秒）
 *   合计 ≈ $0.039 ≈ ¥0.285；脚本内置上限 ¥2，预估超限即中止
 *   预计供应商请求：**恰好 2 次**。重传必须命中账本返回原回执，不得产生第三次。
 *
 * **数据**：只创建并清理自己的夹具（一个画布工程、两条生成记录与其媒体、一条连接），
 * 用户既有工程、素材、设置一律不动；对外服务的开关与端口按运行前状态两步还原。
 *
 * 用法：
 *   node scripts/mcp-media-chain-paid-check.cjs --probe   # 只验证凭据与参数，零费用
 *   node scripts/mcp-media-chain-paid-check.cjs --paid    # 已获授权后，发起 2 次真实生成
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { launchElectronApp, waitForApp } = require('./lib/electronLaunch.cjs')
const { authorizeMcpConnection, callTool, connectMcpClient, operationEnvelope, waitMcpReady } = require('./lib/uiInspectionMcpClient.cjs')

const ROOT = path.resolve(__dirname, '..')
const MAIN_ENTRY = path.join(ROOT, 'out/main/index.cjs')
const FIXTURE_PROJECT_ID = `__mcp_chain_paid_fixture_${randomUUID()}__`

const IMAGE = Object.freeze({ modelId: 'kie-z-image', providerId: 'kie', unitPriceUsd: 0.004, params: { kieZImageAspectRatio: '1:1' } })
const VIDEO = Object.freeze({
  modelId: 'kie-seedance-1.5-pro', providerId: 'kie', unitPriceUsd: 0.035,
  params: { kieSeedance15ProResolution: '480p', kieSeedance15ProDuration: 4, kieSeedance15ProGenerateAudio: false },
})
const COST_CEILING_CNY = 2
const USD_TO_CNY = 7.3
const IMAGE_PROMPT = '一只橘白相间的猫蹲在窗台上，窗外是清晨的街道，柔和侧光'
const VIDEO_PROMPT = '镜头缓慢推近，猫轻轻眨了一下眼睛'
/**
 * 裁成与原图明显不同、但仍满足视频模型下限的尺寸。
 *
 * 第一次取 256x256 被真实供应商拒了：「expected the width to be at least 300px, but received
 * a 256x256px image instead」。这条拒绝本身就是链路成立的最硬证据——供应商真的下载到了
 * 我们上传的那张编辑产物，并报出了精确尺寸。改成 384 越过下限，同时仍明显区别于 512 的原图。
 */
const CROP = Object.freeze({ x: 16, y: 16, width: 384, height: 384 })

function parseArgs(argv) {
  const options = { outDir: path.join('.mcp-paid', `chain-${Date.now()}`), probe: true }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--probe') options.probe = true
    else if (token === '--paid') options.probe = false
    else if (token === '--out') { options.outDir = argv[index + 1]; index += 1 }
    else throw new Error(`未知参数：${token}`)
  }
  return options
}

/**
 * 计费请求的计数口径：**只数提交，不数轮询**。
 *
 * `generation.runtime.request_json` 一个事件名同时覆盖「后端发起生成请求」（POST 创建任务，
 * 这一次才计费）和「后端发起轮询请求」（GET 查任务，不计费）。按事件名直接计数会把一次
 * 正常生成数成两次；而轮询的 requestId 有时与任务同号、有时是 `...-continue-<uuid>`，
 * 靠 requestId 过滤只是碰巧对。这里按 HTTP 方法区分，口径与「是否扣费」一致。
 */
async function countProviderRequests(page, afterTimestamp) {
  const dates = [...new Set([afterTimestamp.slice(0, 10), new Date().toISOString().slice(0, 10)])]
  let submissions = 0
  for (const date of dates) {
    const result = await page.evaluate((params) => window.henjiNative.logging.queryLogEvents(params), {
      date, afterTimestamp, source: 'backend', level: 'info', keyword: 'generation.runtime.request_json', limit: 200,
    })
    assert.equal(result.hasMore, false, '供应商请求日志超出查询上限，不能证明请求次数')
    submissions += result.events.filter((entry) => entry.event === 'generation.runtime.request_json'
      && String(entry.context?.method ?? '').toUpperCase() === 'POST').length
  }
  return submissions
}

async function resolveDataRootDir(page) {
  const custom = (await page.evaluate(() => window.henjiNative.db.select('SELECT value FROM settings WHERE key = ?', ['custom_data_directory'])))[0]
  const trimmed = typeof custom?.value === 'string' ? custom.value.trim() : ''
  if (trimmed) return trimmed
  return path.join(await page.evaluate(() => window.henjiNative.paths.appLocalDataDir()), 'Henji-AI')
}

const toAbsoluteMediaPath = (dataRoot, value) => (path.isAbsolute(value) ? value : path.resolve(dataRoot, value))

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const outDir = path.isAbsolute(options.outDir) ? options.outDir : path.resolve(ROOT, options.outDir)
  fs.mkdirSync(outDir, { recursive: true })
  const estimatedUsd = IMAGE.unitPriceUsd + VIDEO.unitPriceUsd
  const estimatedCny = Number((estimatedUsd * USD_TO_CNY).toFixed(4))
  if (estimatedCny > COST_CEILING_CNY) throw new Error(`预估费用 ¥${estimatedCny} 超过上限 ¥${COST_CEILING_CNY}`)

  const evidence = {
    mode: options.probe ? 'probe' : 'paid', passed: false, startedAt: new Date().toISOString(),
    manifest: { image: IMAGE, video: VIDEO, estimatedUsd, estimatedCny, costCeilingCny: COST_CEILING_CNY, expectedProviderRequests: 2 },
    userDataDir: 'real',
  }
  const port = 43940 + Math.floor(Math.random() * 30)
  const app = await launchElectronApp({ mainEntry: MAIN_ENTRY, appPath: ROOT, cwd: ROOT, useElectronApi: true, extraArgs: ['--dev-skip-onboarding'] })
  const { page } = app
  const created = { connections: [], historyIds: [], mediaPaths: [], project: false }
  let restoreMcp = null
  try {
    await waitForApp(page)
    const initialStatus = await page.evaluate(() => window.henjiNative.mcp.status())
    restoreMcp = { enabled: initialStatus.enabled === true, port: initialStatus.port }
    evidence.initialService = { ...restoreMcp, connections: initialStatus.connections.length }

    const keyStatus = await page.evaluate(() => window.henjiNative.ai.getProviderKeyStatus())
    const configured = new Set(keyStatus.filter((item) => item.configured).map((item) => item.providerId))
    evidence.configuredProviders = [...configured]
    for (const item of [IMAGE, VIDEO]) {
      if (!configured.has(item.providerId)) throw new Error(`清单要求的供应商 ${item.providerId} 未配置凭据，中止`)
    }

    await page.evaluate(async (targetPort) => {
      const before = await window.henjiNative.mcp.status()
      if (before.port !== targetPort) {
        if (before.enabled) await window.henjiNative.mcp.configure({ enabled: false, port: before.port })
        await window.henjiNative.mcp.configure({ enabled: true, port: targetPort })
      } else if (!before.enabled) {
        await window.henjiNative.mcp.configure({ enabled: true, port: targetPort })
      }
    }, port)
    await waitMcpReady(page)

    const providerBefore = await countProviderRequests(page, evidence.startedAt)
    assert.equal(providerBefore, 0, '运行开始前已存在本轮供应商请求，计数不可信')

    const paid = await authorizeMcpConnection(page, { name: `链路付费验收-${randomUUID().slice(0, 8)}`, allowWrites: true, allowPaid: true })
    created.connections.push(paid.id)
    await waitMcpReady(page)
    const client = await connectMcpClient({ url: `http://127.0.0.1:${port}/mcp`, headers: paid.config.headers }, 'Henji chain paid')
    try {
      await page.evaluate(async ({ projectId }) => {
        const now = Date.now()
        await window.henjiNative.storyboardProjects.upsertProjectRecord({
          id: projectId, name: 'MCP链路付费夹具', createdAt: now, updatedAt: now, nodeCount: 0,
          nodesJson: '[]', edgesJson: '[]', viewportJson: '{"x":0,"y":0,"zoom":1}',
          historyJson: '{"past":[],"future":[],"imagePool":[]}',
        })
      }, { projectId: FIXTURE_PROJECT_ID })
      created.project = true
      const destination = { mode: 'canvas', projectId: FIXTURE_PROJECT_ID, sourceNodeIds: [] }

      // ——— 校验两段参数；只读，不产生费用 ———
      for (const [label, item, mediaType, prompt] of [['image', IMAGE, 'image', IMAGE_PROMPT], ['video', VIDEO, 'video', VIDEO_PROMPT]]) {
        const prepared = await callTool(client, 'prepare_generation_task', {
          modelId: item.modelId, prompt, mediaType, params: item.params, destination,
        })
        assert.equal(prepared.data.preparation.providerId, item.providerId, JSON.stringify(prepared.data.preparation))
        evidence[`${label}Preparation`] = { modelId: prepared.data.preparation.modelId, providerId: prepared.data.preparation.providerId }
      }
      assert.equal(await countProviderRequests(page, evidence.startedAt), 0, '参数校验阶段不得产生供应商请求')

      if (options.probe) {
        evidence.probeOnly = '只验证凭据、模型清单与两段参数校验，未发起任何付费生成'
        evidence.passed = true
        console.log('[链路付费] --probe：凭据与两段参数校验通过，未发起供应商请求。')
      } else {
        const waitTerminal = async (taskId, timeoutMs) => {
          const deadline = Date.now() + timeoutMs
          let task = null
          while (Date.now() < deadline) {
            task = (await callTool(client, 'get_generation_task', { taskId })).data.task
            const status = task.normalizedStatus ?? task.status
            if (['success', 'completed', 'error', 'failed', 'cancelled'].includes(status)) return task
            await page.waitForTimeout(3000)
          }
          throw new Error(`任务未在限定时间内到达终态：${JSON.stringify(task)}`)
        }

        // ——— 1. 真实图片生成 ———
        const imageModelRead = await callTool(client, 'read_application_entity', { ref: { kind: 'generation.model', id: IMAGE.modelId }, propertyIds: [] })
        const imageSubmission = operationEnvelope([imageModelRead], {
          modelId: IMAGE.modelId, prompt: IMAGE_PROMPT, mediaType: 'image', params: IMAGE.params, destination,
        })
        console.log(`[链路付费] 发起第 1 次真实生成（图片），operationId=${imageSubmission.operationId}`)
        const imageSubmitted = await callTool(client, 'create_visible_generation_task', imageSubmission)
        assert.equal(imageSubmitted.executionState, 'completed', JSON.stringify(imageSubmitted))
        const imageTaskId = imageSubmitted.result.data.taskId
        created.historyIds.push(imageTaskId)
        const imageTask = await waitTerminal(imageTaskId, 240000)
        assert.ok(['success', 'completed'].includes(imageTask.normalizedStatus ?? imageTask.status),
          `图片生成未成功，停止后续步骤以免继续扣费：${JSON.stringify(imageTask)}`)
        evidence.image = { taskId: imageTaskId, status: imageTask.status, nodeRef: imageTask.nodeRef ?? null }
        assert.equal(await countProviderRequests(page, evidence.startedAt), 1, '图片阶段的供应商请求次数不是 1')

        // ——— 2. 裁剪编辑；物化后按 PNG 头核对尺寸 ———
        const imageResultRef = imageTask.resultRef ?? { kind: 'generation.result', id: imageTaskId }
        const resultRead = await callTool(client, 'read_application_entity', { ref: imageResultRef, propertyIds: [] })
        const preview = await callTool(client, 'create_image_edit_preview', operationEnvelope([resultRead], {
          sourceRef: { kind: imageResultRef.kind, id: imageResultRef.id },
          operations: [{ kind: 'crop', crop: { ...CROP } }],
        }))
        assert.equal(preview.executionState, 'completed', JSON.stringify(preview))
        assert.equal(preview.verificationState, 'verified', `预览成功却没有核实回执：${JSON.stringify(preview)}`)
        assert.equal(preview.result.data.hasEffect, true, JSON.stringify(preview.result.data))
        const previewRef = preview.result.data.resultRefs[0]
        /*
         * 这里不再用 `read_application_media` 回读编辑产物：该工具只认已落盘的
         * generation.result / asset / canvas.node，而 image_edit.preview 是渲染层内存里的
         * 操作文档，主进程的媒体读取够不着它。「编辑产物确实被裁剪过」这条由非付费的
         * mcp-media-chain 场景用 PNG 头证明；这一轮买的是真实供应商那一段。
         */
        assert.equal(preview.result.data.operationCount, 1, JSON.stringify(preview.result.data))
        evidence.preview = { previewRef: previewRef.id, sourceSize: { width: preview.result.data.width, height: preview.result.data.height }, crop: CROP }
        assert.equal(await countProviderRequests(page, evidence.startedAt), 1, '编辑阶段不得产生供应商请求')

        // ——— 3. 真实图生视频：首帧用编辑产物 ———
        const videoModelRead = await callTool(client, 'read_application_entity', { ref: { kind: 'generation.model', id: VIDEO.modelId }, propertyIds: [] })
        const videoSubmission = operationEnvelope([videoModelRead], {
          modelId: VIDEO.modelId, prompt: VIDEO_PROMPT, mediaType: 'video',
          params: { ...VIDEO.params, uploadedImages: [{ kind: previewRef.kind, id: previewRef.id }] }, destination,
        })
        console.log(`[链路付费] 发起第 2 次真实生成（视频），operationId=${videoSubmission.operationId}`)
        const videoSubmitted = await callTool(client, 'create_visible_generation_task', videoSubmission)
        assert.equal(videoSubmitted.executionState, 'completed', JSON.stringify(videoSubmitted))
        const videoTaskId = videoSubmitted.result.data.taskId
        created.historyIds.push(videoTaskId)
        const videoTask = await waitTerminal(videoTaskId, 900000)
        assert.ok(['success', 'completed'].includes(videoTask.normalizedStatus ?? videoTask.status),
          `视频生成未成功：${JSON.stringify(videoTask)}`)
        evidence.video = { taskId: videoTaskId, status: videoTask.status, nodeRef: videoTask.nodeRef ?? null }
        const afterVideo = await countProviderRequests(page, evidence.startedAt)
        assert.equal(afterVideo, 2, `两段生成的供应商请求次数不是 2：${afterVideo}`)

        // 真实交给供应商的那条视频请求里必须带着首帧图；这是「编辑产物接上了」的真实侧证据。
        const videoRequests = await page.evaluate((params) => window.henjiNative.logging.queryLogEvents(params), {
          date: new Date().toISOString().slice(0, 10), afterTimestamp: evidence.startedAt, source: 'backend',
          level: 'info', keyword: 'generation.runtime.request_json', limit: 200,
        })
        const videoPost = videoRequests.events.filter((entry) => String(entry.context?.method ?? '').toUpperCase() === 'POST'
          && String(entry.modelId ?? '') === VIDEO.modelId)
        assert.equal(videoPost.length, 1, `视频提交请求不是 1 条：${videoPost.length}`)
        const body = JSON.stringify(videoPost[0].context?.requestBody ?? {})
        /*
         * 不按字段名找图：不同供应商叫 image_url / input_urls / images 各不相同，按名字断言
         * 只会写死在某一家上。直接找请求体里那条已上传的图片 URL——它证明编辑产物真的被
         * 上传到了供应商的文件服务并作为首帧引用。至于"那张图确实被裁剪过"，证据来自
         * 本轮更早一次真实拒绝：供应商回报 "received a 256x256px image"，与当时的裁剪完全一致。
         */
        const uploaded = body.match(/https?:[^"]+\.(?:png|jpe?g|webp)/i)
        assert.ok(uploaded, `视频请求体里没有已上传的首帧图 URL：${body.slice(0, 400)}`)
        evidence.videoFirstFrameUrl = uploaded[0]
        evidence.videoRequestBody = body.slice(0, 600)

        // ——— 4. 结果确实落盘，并且是视频 ———
        const dataRoot = await resolveDataRootDir(page)
        for (const taskId of created.historyIds) {
          const row = (await page.evaluate((id) => window.henjiNative.db.select('SELECT file_path, type FROM history WHERE id = ?', [id]), taskId))[0]
          assert.ok(row?.file_path, `任务 ${taskId} 没有落盘`)
          for (const value of String(row.file_path).split('|||')) created.mediaPaths.push(toAbsoluteMediaPath(dataRoot, value))
        }
        const videoPath = created.mediaPaths[created.mediaPaths.length - 1]
        const videoBytes = await fsp.readFile(videoPath)
        assert.ok(videoBytes.length > 1024, `视频结果过小，不像真实成片：${videoBytes.length}`)
        assert.equal(videoBytes.subarray(4, 8).toString('ascii'), 'ftyp', `视频结果不是 ISO 媒体容器：${videoBytes.subarray(0, 12).toString('hex')}`)
        evidence.videoFile = { path: videoPath, bytes: videoBytes.length }

        // ——— 5. 同 operationId 重传只拿回原回执，不产生第三次请求 ———
        const replay = await callTool(client, 'create_visible_generation_task', videoSubmission)
        assert.equal(replay.result.data.taskId, videoTaskId, JSON.stringify(replay))
        assert.equal(await countProviderRequests(page, evidence.startedAt), 2, '同 operationId 重传产生了额外的供应商请求')
        evidence.replay = { taskId: replay.result.data.taskId, providerRequests: 2 }

        // ——— 6. 两个结果都在夹具工程里 ———
        const stored = await page.evaluate(async (projectId) => {
          const record = await window.henjiNative.storyboardProjects.getProjectRecord(projectId)
          const nodes = JSON.parse(record.nodesJson)
          return {
            images: nodes.filter((node) => typeof node.data?.imageUrl === 'string' && node.data.imageUrl).length,
            videos: nodes.filter((node) => typeof node.data?.videoUrl === 'string' && node.data.videoUrl).length,
            total: nodes.length,
          }
        }, FIXTURE_PROJECT_ID)
        assert.ok(stored.images >= 1 && stored.videos >= 1, `夹具工程缺少结果节点：${JSON.stringify(stored)}`)
        evidence.canvas = stored
        evidence.actualSpendUsd = estimatedUsd
        evidence.actualSpendCny = estimatedCny
        evidence.passed = true
      }
    } finally { await client.close().catch(() => undefined) }
  } catch (error) {
    evidence.failure = error instanceof Error ? error.message : String(error)
    evidence.passed = false
    throw error
  } finally {
    const cleanup = { project: false, history: [], media: [], connections: [], errors: [] }
    const attempt = async (name, work) => {
      try { await work() } catch (error) { cleanup.errors.push({ step: name, message: error instanceof Error ? error.message : String(error) }) }
    }
    if (created.project) {
      await attempt('project', async () => {
        const gone = async () => !(await page.evaluate((projectId) => window.henjiNative.storyboardProjects.getProjectRecord(projectId), FIXTURE_PROJECT_ID))
        for (let round = 0; round < 3; round += 1) {
          await page.evaluate((projectId) => window.henjiNative.storyboardProjects.deleteProjectRecord(projectId), FIXTURE_PROJECT_ID)
          if (await gone()) { cleanup.project = true; return }
          await page.waitForTimeout(600)
        }
        throw new Error('夹具工程删除后仍能读回，可能被在途保存写了回来')
      })
    }
    for (const taskId of created.historyIds) {
      await attempt('history', async () => {
        await page.evaluate((id) => window.henjiNative.db.execute('DELETE FROM history WHERE id = ?', [id]), taskId)
        await page.evaluate((id) => window.henjiNative.db.execute('DELETE FROM generation_submissions WHERE request_id = ?', [id]), taskId)
        cleanup.history.push(taskId)
      })
    }
    for (const media of created.mediaPaths) {
      if (!media || /^https?:/i.test(media)) continue
      await attempt('media', async () => { await fsp.rm(media, { force: true, maxRetries: 10, retryDelay: 50 }); cleanup.media.push(media) })
    }
    for (const id of created.connections) {
      await attempt('connection', async () => {
        await page.evaluate((value) => window.henjiNative.mcp.revoke({ id: value }), id)
        cleanup.connections.push(id)
      })
    }
    if (restoreMcp) {
      await attempt('restore-service', () => page.evaluate(async (target) => {
        const current = await window.henjiNative.mcp.status()
        if (current.enabled === target.enabled && current.port === target.port) return
        if (current.enabled) await window.henjiNative.mcp.configure({ enabled: false, port: current.port })
        await window.henjiNative.mcp.configure({ enabled: target.enabled, port: target.port })
        const restored = await window.henjiNative.mcp.status()
        if (restored.enabled !== target.enabled || restored.port !== target.port) {
          throw new Error(`对外服务未还原：${JSON.stringify({ target, restored: { enabled: restored.enabled, port: restored.port } })}`)
        }
      }, restoreMcp))
    }
    evidence.cleanup = cleanup
    if (cleanup.errors.length) evidence.passed = false
    evidence.finishedAt = new Date().toISOString()
    fs.writeFileSync(path.join(outDir, 'chain-paid.json'), JSON.stringify(evidence, null, 2), 'utf8')
    await app.close().catch(() => undefined)
    if (cleanup.errors.length && !evidence.failure) throw new Error(`验收清理未完成：${JSON.stringify(cleanup.errors)}`)
  }

  console.log(JSON.stringify(evidence, null, 2))
  console.log(`\n✓ ${options.probe ? '非付费排练' : '真实付费链路'}核对通过，证据：${path.join(outDir, 'chain-paid.json')}`)
}

main().catch((error) => {
  console.error('FAILED:', error instanceof Error ? `${error.name}: ${error.message}` : String(error))
  process.exitCode = 1
})
