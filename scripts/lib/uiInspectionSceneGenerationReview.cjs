const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const { createServer } = require('node:http')
const path = require('node:path')
const { holdGenerationResults } = require('./uiInspectionGenerationBackground.cjs')
// 付费保护（共享）：拒绝 ai:generate，续查只放行 __ 开头的夹具任务
const { blockPaidGeneration } = require('./uiReviewPaidGuard.cjs')

/**
 * 生成工作区逐项核对（界面计划 5.3）：生成记录的各状态与命令带浮层。
 *
 * 隔离资料目录里写入一组生成记录夹具（图片单张/多张、视频、音频、长提示词 + 多参考图、失败、进行中），
 * 进行中的那条由 `holdGenerationResults` 接住正式续查链路：供应商一侧在 IPC 之后替换，
 * 渲染层的恢复、进度细线与持久化仍走正式代码，不发出任何付费请求。
 */
const PREFIX = '__review_history_'
const IMAGE_FIXTURE = path.resolve('resources/icons/icon.png')
const VIDEO_FIXTURE = path.resolve('scripts/fixtures/plain_video.mp4')

/** 3 秒 8kHz 单声道 PCM：振幅起伏的低音量正弦，让迷你波形有可见的起伏（测试实例已静音）。 */
function createWaveFixture() {
  const rate = 8000
  const samples = rate * 3
  const wave = Buffer.alloc(44 + samples * 2)
  wave.write('RIFF'); wave.writeUInt32LE(wave.length - 8, 4); wave.write('WAVEfmt ', 8)
  wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22)
  wave.writeUInt32LE(rate, 24); wave.writeUInt32LE(rate * 2, 28)
  wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34)
  wave.write('data', 36); wave.writeUInt32LE(samples * 2, 40)
  for (let i = 0; i < samples; i++) {
    const envelope = 0.25 + 0.75 * Math.abs(Math.sin((i / rate) * Math.PI * 1.7))
    wave.writeInt16LE(Math.round(Math.sin((i / rate) * Math.PI * 2 * 220) * envelope * 6000), 44 + i * 2)
  }
  return wave
}

/**
 * 提示词优化的本机流式模型替身（OpenAI 兼容）：第一次请求慢速流出思考与正文，便于截“流式预览中”；
 * 第二次返回 HTTP 500，看失败提示。不访问外部模型，不产生费用（与助手核对夹具同一做法）。
 */
async function startOptimizeStub() {
  const chunk = (delta, finish = null) => `data: ${JSON.stringify({ id: 'review-optimize', object: 'chat.completion.chunk', created: 1,
    model: 'fixture', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
  const state = { requests: 0 }
  const server = createServer(async (request, response) => {
    for await (const _ of request) { /* 读完请求体 */ }
    state.requests += 1
    if (state.requests > 1) {
      response.writeHead(500, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: { message: '核对替身：服务暂时不可用', type: 'fixture_error' } }))
      return
    }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.flushHeaders()
    const words = '午后的阳光斜照进木质窗台，一只毛色橘黄的猫蜷成一团打盹，胡须在光里清晰可见，背景是虚化的绿植与白色纱帘，暖色调，浅景深，胶片质感。'
    for (const piece of words.match(/.{1,3}/g)) {
      if (response.destroyed) return
      response.write(chunk({ content: piece }))
      await new Promise((resolve) => setTimeout(resolve, 160))
    }
    response.write(chunk({}, 'stop'))
    response.end('data: [DONE]\n\n')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { state, baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    close: async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)) } }
}

function createGenerationReviewScenes(context) {
  const { setupGeneration, settlePage } = context

  async function seedHistory(page) {
    const imageBytes = [...await fs.readFile(IMAGE_FIXTURE)]
    const videoBytes = [...await fs.readFile(VIDEO_FIXTURE)]
    const waveBytes = [...createWaveFixture()]
    await setupGeneration(page)
    return page.evaluate(async ({ prefix, imageBytes, videoBytes, waveBytes }) => {
      const image = await window.henjiNative.image.persistImageBinary(new Uint8Array(imageBytes), 'png')
      const video = image.replace(/\.[^.]+$/, '-review.mp4')
      const audio = image.replace(/\.[^.]+$/, '-review.wav')
      await window.henjiNative.fs.writeFile(video, new Uint8Array(videoBytes))
      await window.henjiNative.fs.writeFile(audio, new Uint8Array(waveBytes))
      await window.henjiNative.db.execute(`DELETE FROM history WHERE id GLOB '${prefix}*'`, [])
      const longPrompt = '黄昏时分的海港，渔船缓缓驶入，远处灯塔亮起第一束光；保留参考图的人物服装与配色，镜头从高处俯拍逐渐推近到甲板上的人物，'
        .repeat(4)
      const rows = [
        // id 后缀, type, model, prompt, params, file_path, status, task_id
        ['image-single', 'image', 'kie-z-image', '一只橘猫趴在窗台上晒太阳，柔和的午后光线', {}, image, 'success', null],
        ['image-multi', 'image', 'kie-z-image', '同一角色的四个表情：开心、惊讶、生气、困倦', {}, [image, image, image, image].join('|||'), 'success', null],
        ['long-prompt', 'image', 'kie-z-image', longPrompt, { uploadedFilePaths: [image, image, image, image, image] }, image, 'success', null],
        ['video', 'video', 'kie-z-image', '海浪拍打礁石的慢镜头', {}, video, 'success', null],
        ['audio', 'audio', 'kie-z-image', '欢迎来到痕迹AI，今天我们来聊一聊生成工作区。', {}, audio, 'success', null],
        ['failed', 'image', 'kie-z-image', '赛博朋克风格的城市夜景', {}, null, 'error', null],
        ['generating', 'image', 'kie-z-image', '雪山下的湖泊倒映着星空', {}, null, 'generating', '__generation_background_0'],
      ]
      for (const [index, [suffix, type, model, prompt, params, filePath, status, taskId]] of rows.entries()) {
        await window.henjiNative.db.execute(
          'INSERT INTO history (id,provider_id,model_id,type,prompt,params,file_path,status,task_id,error_message,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
          [`${prefix}${suffix}`, 'kie', model, type, prompt, JSON.stringify(params), filePath, status, taskId,
            status === 'error' ? '供应商返回：内容审核未通过，请调整提示词后重试。' : null,
            new Date(Date.now() - (rows.length - index) * 60000).toISOString()],
        )
      }
      return image
    }, { prefix: PREFIX, imageBytes, videoBytes, waveBytes })
  }

  async function scrollHistory(page, position) {
    await page.evaluate((position) => {
      const scroller = document.querySelector('[data-generation-history-scroll]')
      scroller.scrollTop = position === 'top' ? 0 : scroller.scrollHeight
    }, position)
    await page.waitForTimeout(300)
    await settlePage(page)
  }

  const card = (page, suffix) => page.locator(`[data-generation-task-id="${PREFIX}${suffix}"]`)

  return [{
    id: 'generation-review-history',
    surface: '生成',
    name: '核对-生成记录各状态与命令带',
    writesUserData: true,
    async setup(page, app, inspection) {
      let fixture = null
      const unblock = await blockPaidGeneration(app)
      try {
        const image = await seedHistory(page)
        fixture = await holdGenerationResults(app, image, 1)
        await page.reload({ waitUntil: 'domcontentloaded' })
        await card(page, 'generating').waitFor({ timeout: 20000 })
        await card(page, 'failed').waitFor()
        await settlePage(page)
        // 首屏定位最新：进行中 + 失败 + 音频
        await inspection.capture('latest')

        // 进行中：真实续查链路，进度细线随进度推进
        assert.equal((await fixture.evaluate((state) => state.snapshot())).requests.length, 1, '进行中的记录没有进入正式续查链路')
        await page.waitForFunction((id) => {
          const bar = document.querySelector(`[data-generation-task-id="${id}"] [role="progressbar"]`)
          return Number(bar?.getAttribute('aria-valuenow') ?? 0) > 0
        }, `${PREFIX}generating`, { timeout: 15000 })

        // 悬停工具条（失败记录与完成记录各一）
        await card(page, 'audio').hover()
        await settlePage(page)
        await inspection.capture('audio-hover')
        await card(page, 'failed').hover()
        await settlePage(page)
        await inspection.capture('failed-hover')

        // 视频完成
        await card(page, 'video').scrollIntoViewIfNeeded()
        await card(page, 'video').hover()
        await settlePage(page)
        await inspection.capture('video')

        // 结果图右键菜单 + 悬停项
        await scrollHistory(page, 'top')
        const result = card(page, 'image-single').locator('[data-generation-result]').first()
        await result.click({ button: 'right' })
        const menu = page.getByRole('menu').filter({ visible: true }).first()
        await menu.waitFor({ timeout: 8000 })
        await menu.getByRole('menuitem').nth(1).hover()
        await settlePage(page)
        await inspection.capture('context-menu')
        await page.keyboard.press('Escape')
        await menu.waitFor({ state: 'hidden', timeout: 8000 })

        // 顶部：单张、四张、长提示词 + 多参考图
        await page.mouse.move(4, 400)
        await settlePage(page)
        await inspection.capture('top')

        // 类型分段：悬停与选中
        const typeTabs = page.getByRole('radiogroup').first()
        await typeTabs.getByRole('radio', { name: '视频' }).hover()
        await settlePage(page)
        await inspection.capture('type-hover')
        await typeTabs.getByRole('radio', { name: '视频' }).click()
        await settlePage(page)
        await inspection.capture('type-video')
        await typeTabs.getByRole('radio', { name: '全部类型' }).click()

        // 搜索展开 + 筛选从属带
        await page.getByRole('button', { name: '搜索历史' }).click()
        await settlePage(page)
        await inspection.capture('search')
        // 筛选从属带里的下拉（来源 / 模型 / 时间），打开第一个看菜单
        const keyword = page.getByPlaceholder('搜索提示词、模型或错误信息')
        const strip = keyword.locator('xpath=ancestor::*[.//*[@data-dropdown-button]][1]')
        await strip.locator('[data-dropdown-button]').first().click()
        await page.getByRole('listbox').filter({ visible: true }).first().waitFor({ timeout: 8000 })
        await settlePage(page)
        await inspection.capture('filter-menu')
        await page.keyboard.press('Escape')
        await page.getByRole('listbox').filter({ visible: true }).first().waitFor({ state: 'hidden', timeout: 8000 })
        // 无结果
        await keyword.fill('不存在的关键词zzz')
        await settlePage(page)
        await inspection.capture('search-empty')
        await keyword.fill('')

        // 时间筛选：自定义时间 → 日期选择浮层
        await strip.locator('[data-dropdown-button]').first().click()
        await page.getByRole('option', { name: '自定义时间' }).click()
        await page.getByRole('option', { name: '自定义时间' }).waitFor({ state: 'hidden', timeout: 8000 })
        await page.getByRole('button', { name: '开始日期' }).or(page.getByLabel('开始日期')).first().click()
        await page.waitForTimeout(300)
        await settlePage(page)
        await inspection.capture('date-picker')
        await page.keyboard.press('Escape')
        await page.waitForTimeout(300)

        // 更多 → 清除历史确认（只看不确认）
        await page.getByRole('button', { name: '更多操作' }).click()
        await settlePage(page)
        await inspection.capture('more-menu')
        await page.getByRole('button', { name: '清除历史' }).click()
        const dialog = page.getByRole('dialog').filter({ visible: true }).first()
        await dialog.waitFor({ timeout: 8000 })
        await settlePage(page)
        await inspection.capture('clear-dialog')
        // “清除所有历史记录”第一次点击只进入待确认态（第二次才执行）：只点一次看危险确认外观
        await dialog.getByRole('button', { name: '清除所有历史记录' }).click()
        await settlePage(page)
        await inspection.capture('clear-confirm')
        await page.keyboard.press('Escape')
        await dialog.waitFor({ state: 'hidden', timeout: 8000 })
      } finally {
        if (fixture) {
          await fixture.evaluate((state) => state.dispose())
          await fixture.dispose()
        }
        await unblock()
      }
    },
  }, {
    id: 'generation-review-optimize',
    surface: '生成',
    name: '核对-提示词优化（方案选择、方案管理、流式预览、失败）',
    writesUserData: true,
    // 第二次请求由本机替身有意返回 500：失败链路的错误日志是预期的
    expectedLogEvents: ['llm_runtime.chat_stream.failed', 'llm_runtime.chat_stream.invoke_failed'],
    async setup(page, app, inspection) {
      const unblock = await blockPaidGeneration(app)
      await setupGeneration(page)
      const stub = await startOptimizeStub()
      let baseline = null
      try {
        baseline = await page.evaluate(async (baseUrl) => {
          const before = await window.henjiNative.llm.readConfig() ?? { providers: [], models: [], promptProfiles: [], agentProfiles: [] }
          const provider = { providerId: 'ui-review-optimize', displayName: '核对替身', adapter: 'openai-compatible', baseUrl, enabled: true, setup: { kind: 'custom' } }
          const model = { providerId: provider.providerId, modelId: 'fixture', displayName: '核对替身模型', adapter: provider.adapter, baseUrl, enabled: true,
            capabilities: { text: true, image: false, video: false, audio: false, streaming: true, toolCall: false, parallelTools: false, jsonOutput: false,
              structuredOutputMode: 'none', reasoning: false, sampling: true, contextWindow: 32768, maxOutputTokens: 1024, usage: true } }
          await window.henjiNative.llm.commitProviderSettings({ provider, seedModels: [model], baselineConfig: before, credential: { kind: 'set', apiKey: 'ui-review-fixture-key' } })
          return before
        }, stub.baseUrl)
        // 配置变更后重载，让生成页按新配置读取可用模型
        await page.reload({ waitUntil: 'domcontentloaded' })
        await setupGeneration(page)
        const editor = page.locator('[data-onboarding-target="prompt"] [contenteditable="true"]').first()
        await editor.click()
        await page.keyboard.type('一只猫在窗台上晒太阳')
        const optimize = page.getByRole('button', { name: /优化/ }).filter({ visible: true }).first()
        await optimize.hover()
        await settlePage(page)
        await inspection.capture('button-hover')

        // 方案选择浮层（默认“左键先选择配置”）
        await optimize.click()
        const selector = page.locator('[data-panel-scroll-region]').filter({ visible: true }).last()
        await selector.waitFor({ timeout: 8000 })
        await settlePage(page)
        await inspection.capture('selector')

        // 选第一个方案 → 流式预览
        await selector.getByRole('button').filter({ hasNotText: /管理|编辑/ }).last().click()
        await page.locator('.prompt-optimize-preview').waitFor({ timeout: 10000 })
        await page.waitForTimeout(1500)
        await inspection.capture('streaming')
        await page.locator('.prompt-optimize-preview').waitFor({ state: 'detached', timeout: 30000 })
        await settlePage(page)
        await inspection.capture('optimized')

        // 第二次：替身返回 500，看失败提示
        await optimize.click()
        await selector.waitFor({ timeout: 8000 })
        await selector.getByRole('button').filter({ hasNotText: /管理|编辑/ }).last().click()
        await page.waitForTimeout(1500)
        await settlePage(page)
        await inspection.capture('failed')
        assert.ok(stub.state.requests >= 2, '提示词优化没有请求到本机替身')

        // 关掉失败提示，再右键：方案管理
        const alert = page.getByRole('alertdialog').or(page.getByRole('dialog')).filter({ visible: true }).first()
        await alert.getByRole('button', { name: '关闭' }).click()
        await alert.waitFor({ state: 'hidden', timeout: 8000 })
        await optimize.click({ button: 'right' })
        await page.locator('[data-panel-scroll-region]').filter({ visible: true }).last().waitFor({ timeout: 8000 })
        await page.waitForTimeout(400)
        await settlePage(page)
        await inspection.capture('profiles')
        await page.keyboard.press('Escape')
      } finally {
        if (baseline) await page.evaluate((config) => window.henjiNative.llm.writeConfig(config), baseline).catch(() => undefined)
        await stub.close()
        await unblock()
      }
    },
  }]
}

module.exports = { createGenerationReviewScenes }
