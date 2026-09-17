/**
 * 跨域媒体链路验收：图片生成 → 图片编辑 → 用编辑产物当首帧图生视频 → 两个结果都落进未打开的 B 工程。
 *
 * 这条补的是**链路本身**，不是任何单环节。现有场景各自只证明了一段：`mcp-generation-canvas` 直接
 * 植入一条已完成的历史再落图，根本没走提交；图片编辑的场景以夹具文档为起点，来源不是生成结果；
 * 而「编辑产物作为下一次生成的输入」这一步，`resolveGenerationMediaReferences` 只有单元测试。
 * 三段各自绿着，接起来是否成立没有任何证据。
 *
 * 全场唯一的替身放在 `ai:generate` 这个 IPC 之后：能力派发、参数准备、费用预检、操作账本、
 * 媒体引用解析、结果落盘与画布投影全部走正式实现，零真实供应商请求。
 *
 * 最关键的一条断言是**交给供应商的那张图**：它必须是裁剪后的编辑产物，而不是原始生成结果。
 * 直接读取请求里那个文件的 PNG 头核对宽高——链路断在任何一环，这里都对不上。
 */
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope } = require('./uiInspectionMcpClient.cjs')

const IMAGE_MODEL = 'kie-z-image'
const VIDEO_MODEL = 'kie-hailuo-02'
const VIDEO_FIXTURE = path.resolve('scripts/fixtures/plain_video.mp4')
/** 裁成一个和原图明显不同的尺寸：链路传错图时宽高对不上，断言当场红。 */
const CROP = Object.freeze({ x: 8, y: 8, width: 96, height: 64 })

/** 从 PNG 头直接读宽高（IHDR 固定在第 16~24 字节），不引入图像库。 */
function readPngSize(bytes) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature)) return null
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

/** 请求里的媒体可能是本地路径或自定义协议，统一还原成本地路径再比对。 */
function toLocalPath(value) {
  if (typeof value !== 'string' || !value) return null
  const stripped = value.replace(/^file:[/][/]/i, '').replace(/^henji-media:[/][/]/i, '')
  return decodeURIComponent(stripped).replace(/^[/]([A-Za-z]:)/, '$1')
}

function createMcpMediaChainScenes(context) {
  const { settlePage, setupCanvas, canvasFixtureProjectId } = context

  /** 等任务走到终态；只查询，不重发。 */
  const waitTerminal = async (client, taskId, page) => {
    const deadline = Date.now() + 60000
    let task = null
    while (Date.now() < deadline) {
      task = (await callTool(client, 'get_generation_task', { taskId })).data.task
      const status = task.normalizedStatus ?? task.status
      if (['success', 'completed', 'error', 'failed', 'cancelled'].includes(status)) return task
      await page.waitForTimeout(400)
    }
    throw new Error(`任务未在限定时间内到达终态：${JSON.stringify(task)}`)
  }

  return [{
    id: 'mcp-media-chain', surface: '画布', name: '外部连接-生成到编辑再到图生视频', writesUserData: true,
    setup: async (page, electronApp, { capture }) => {
      await page.reload()
      await settlePage(page, 500)

      const projectB = crypto.randomUUID()
      await page.evaluate(async (projectId) => {
        const now = Date.now()
        await window.henjiNative.storyboardProjects.upsertProjectRecord({
          id: projectId, name: 'MCP链路后台工程', createdAt: now, updatedAt: now, nodeCount: 0,
          nodesJson: '[]', edgesJson: '[]', viewportJson: '{"x":0,"y":0,"zoom":1}',
          historyJson: '{"past":[],"future":[],"imagePool":[]}',
        })
      }, projectB)

      // 图片替身产物：每次生成给一份独立副本，避免和原始夹具同路径混淆。
      const stagedImage = path.join(await page.evaluate(() => window.henjiNative.paths.appLocalDataDir()), 'Uploads', `chain-${crypto.randomUUID()}.png`)
      await fsp.mkdir(path.dirname(stagedImage), { recursive: true })
      await fsp.copyFile(context.REFERENCE_FIXTURE_IMAGE, stagedImage)
      const sourceSize = readPngSize(await fsp.readFile(stagedImage))
      assert.ok(sourceSize, '图片夹具必须是 PNG，否则后面的宽高核对失去意义')
      assert.notDeepEqual(sourceSize, { width: CROP.width, height: CROP.height },
        '裁剪尺寸必须与原图不同，否则「传错图」这条断言恒真')

      /*
       * 替身只接管 IPC 之后的供应商调用，并按模型区分图片/视频；请求原样留下来，
       * 供后面核对交给供应商的究竟是哪一张图。
       */
      await electronApp.evaluate(({ ipcMain }, fixtures) => {
        globalThis.__chainRequests = []
        ipcMain.removeHandler('ai:generate')
        ipcMain.handle('ai:generate', async (_event, request) => {
          globalThis.__chainRequests.push(JSON.parse(JSON.stringify(request)))
          const isVideo = String(request.modelId ?? '').includes('hailuo')
          const filePath = isVideo ? fixtures.video : fixtures.image
          return { ok: true, data: { status: 'completed', url: filePath, filePath } }
        })
      }, { image: stagedImage, video: VIDEO_FIXTURE })
      await page.evaluate(() => window.henjiNative.ai.setProviderApiKey('kie', 'isolated-chain-fixture'))
      await page.reload()
      await settlePage(page, 500)

      // A：用户停在夹具工程上，全程不许跳走。
      await setupCanvas(page)
      await page.locator(`[data-project-id="${canvasFixtureProjectId}"]:visible`).click()
      await settlePage(page, 700)
      const nodesInA = await page.locator('.react-flow__node').count()
      await capture('editing-a')

      const identity = await authorizeMcpConnection(page, { name: `链路验收-${projectB.slice(0, 8)}`, allowWrites: true, allowPaid: true })
      const client = await connectMcpClient(identity.config, 'Henji media chain Reality')
      try {
        // ——— 1. 图片生成：真实提交，目标是从未打开的 B ———
        /*
         * 校验必须带上和提交同一个 destination。省略时 destination 会回落到**用户当前界面**：
         * 活动工作区是画布且有选中节点时，那个节点会被当成输入图注入，于是像 kie-z-image
         * 这种纯文生图（images 上限 0）会因为「用户刚好选中了一个节点」而校验失败。
         * 单独跑这个场景时画布没有选中项，所以看不出来；和别的场景连跑就必现。
         */
        const destination = { mode: 'canvas', projectId: projectB, sourceNodeIds: [] }
        const prepared = await callTool(client, 'prepare_generation_task', {
          modelId: IMAGE_MODEL, prompt: '链路验收底图', mediaType: 'image', params: { kieZImageAspectRatio: '1:1' },
          destination,
        })
        assert.equal(prepared.data.preparation.providerId, 'kie', JSON.stringify(prepared.data.preparation))
        const modelRead = await callTool(client, 'read_application_entity', { ref: { kind: 'generation.model', id: IMAGE_MODEL }, propertyIds: [] })
        const submitted = await callTool(client, 'create_visible_generation_task', operationEnvelope([modelRead], {
          modelId: IMAGE_MODEL, prompt: '链路验收底图', mediaType: 'image', params: { kieZImageAspectRatio: '1:1' },
          destination,
        }))
        assert.equal(submitted.executionState, 'completed', JSON.stringify(submitted))
        const imageTask = await waitTerminal(client, submitted.result.data.taskId, page)
        assert.ok(['success', 'completed'].includes(imageTask.normalizedStatus ?? imageTask.status), JSON.stringify(imageTask))
        assert.equal(imageTask.resultAvailable, true, JSON.stringify(imageTask))
        /*
         * 画布去向的任务快照只给 taskRef / nodeRef / resultRefs(canvas.node)，不给
         * generation.result；而下游的图片编辑只收 asset / generation.result / image_edit.preview。
         * 稳定引用的 id 与 taskId 同源，所以这里显式构造一次，并断言它真的能被下游接受——
         * 这条同时也是「画布结果能不能进编辑」这个契约的证据。
         */
        const imageResultRef = imageTask.resultRef ?? { kind: 'generation.result', id: imageTask.taskId }
        assert.equal(imageResultRef.kind, 'generation.result', JSON.stringify(imageTask))

        // ——— 2. 图片编辑：以生成结果为来源裁剪，得到编辑产物 ———
        const resultRead = await callTool(client, 'read_application_entity', { ref: imageResultRef, propertyIds: [] })
        const preview = await callTool(client, 'create_image_edit_preview', operationEnvelope([resultRead], {
          sourceRef: { kind: imageResultRef.kind, id: imageResultRef.id },
          operations: [{ kind: 'crop', crop: { ...CROP } }],
        }))
        assert.equal(preview.executionState, 'completed', JSON.stringify(preview))
        assert.equal(preview.verificationState, 'verified', `预览成功却没有核实回执：${JSON.stringify(preview)}`)
        assert.equal(preview.result.data.hasEffect, true, '裁剪必须被认定为真实生效的编辑')
        /*
         * 预览是一份记录操作的文档，不是已经栅格化的图：这里的 width/height 按契约给的是
         * **来源**尺寸，裁剪要到物化那一步才体现。所以断言对着源尺寸，真正的裁剪证据在
         * 后面那张交给供应商的图上。
         */
        assert.deepEqual({ width: preview.result.data.width, height: preview.result.data.height },
          sourceSize, JSON.stringify(preview.result.data))
        const previewRef = preview.result.data.resultRefs[0]
        assert.equal(previewRef.kind, 'image_edit.preview', JSON.stringify(previewRef))

        // ——— 3. 图生视频：首帧用编辑产物，目标仍是未打开的 B ———
        const previewRead = await callTool(client, 'read_application_entity', { ref: previewRef, propertyIds: [] })
        const videoModelRead = await callTool(client, 'read_application_entity', { ref: { kind: 'generation.model', id: VIDEO_MODEL }, propertyIds: [] })
        /*
         * 基线只给模型：`create_visible_generation_task` 声明的操作目标就只有 generation.model。
         * 编辑产物是**输入媒体**，不是被改写的目标，多给一条基线会被正式守卫按「包含无关作用域」
         * 直接拒掉——这条拒绝是对的，上面那次 previewRead 只用来证明该引用可被发现和读取。
         */
        assert.equal(previewRead.data.ref.kind, 'image_edit.preview', JSON.stringify(previewRead.data))
        const videoSubmitted = await callTool(client, 'create_visible_generation_task', operationEnvelope([videoModelRead], {
          modelId: VIDEO_MODEL, prompt: '链路验收：让底图动起来', mediaType: 'video',
          params: { uploadedImages: [{ kind: previewRef.kind, id: previewRef.id }] },
          destination,
        }))
        assert.equal(videoSubmitted.executionState, 'completed', JSON.stringify(videoSubmitted))
        const videoTask = await waitTerminal(client, videoSubmitted.result.data.taskId, page)
        assert.ok(['success', 'completed'].includes(videoTask.normalizedStatus ?? videoTask.status), JSON.stringify(videoTask))

        /*
         * 链路的核心断言：交给供应商的那张图必须是裁剪后的编辑产物。
         * 只比路径不够——路径换了但内容还是原图同样算断链，所以直接读 PNG 头核对宽高。
         */
        const requests = await electronApp.evaluate(() => globalThis.__chainRequests ?? [])
        const videoRequest = requests.find((item) => String(item.modelId ?? '').includes('hailuo'))
        assert.ok(videoRequest, `没有捕获到视频生成请求：${JSON.stringify(requests.map((item) => item.modelId))}`)
        const handed = [
          ...(Array.isArray(videoRequest.params?.images) ? videoRequest.params.images : []),
          ...(Array.isArray(videoRequest.params?.uploadedFilePaths) ? videoRequest.params.uploadedFilePaths : []),
        ].map(toLocalPath).filter(Boolean)
        assert.ok(handed.length > 0, `视频请求没有带上任何首帧图：${JSON.stringify(videoRequest.params)}`)
        assert.equal(handed.some((value) => path.resolve(value) === path.resolve(stagedImage)), false,
          `交给供应商的仍是原始生成结果，编辑产物没有接上：${JSON.stringify(handed)}`)
        const handedSize = readPngSize(await fsp.readFile(handed[0]))
        assert.deepEqual(handedSize, { width: CROP.width, height: CROP.height },
          `交给供应商的图片尺寸不是裁剪后的编辑产物：${JSON.stringify({ handed: handed[0], handedSize, CROP })}`)

        // 全程不许把用户从 A 带走。
        assert.equal(await page.locator('.react-flow__node').count(), nodesInA, '后台链路不得改变用户当前打开的工程')
      } finally {
        await client.close()
        await disableMcp(page)
      }

      // ——— 4. 打开 B：两段结果都在，且视频节点确实拿到了视频 ———
      await setupCanvas(page)
      await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click()
      await settlePage(page, 600)
      await page.locator(`[data-project-id="${projectB}"]:visible`).click()
      await settlePage(page, 1200)
      const stored = await page.evaluate(async (projectId) => {
        const record = await window.henjiNative.storyboardProjects.getProjectRecord(projectId)
        const nodes = JSON.parse(record.nodesJson)
        return {
          name: record.name,
          images: nodes.filter((node) => typeof node.data?.imageUrl === 'string' && node.data.imageUrl).length,
          videos: nodes.filter((node) => typeof node.data?.videoUrl === 'string' && node.data.videoUrl).length,
          total: nodes.length,
        }
      }, projectB)
      assert.equal(stored.name, 'MCP链路后台工程')
      assert.equal(stored.images >= 1, true, `B 工程缺少图片结果节点：${JSON.stringify(stored)}`)
      assert.equal(stored.videos >= 1, true, `B 工程缺少视频结果节点：${JSON.stringify(stored)}`)
      await capture('reopened-b')
    },
  }]
}

module.exports = { createMcpMediaChainScenes }
