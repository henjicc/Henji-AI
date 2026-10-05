/**
 * 界面核对步骤 `seedHistory`（任务 5.7）：往隔离资料目录写一组生成记录夹具，供媒体查看器、结果菜单、
 * 通知提示等通用界面的步骤使用。素材是仓库夹具（图片 / 视频）与现生成的 3 秒低音量 WAV；
 * `missing` 是一个不存在的长路径，用来走“复制失败”等正式失败提示。
 *
 * 只写 `history` 表里以 PREFIX 开头的行，收尾时删除这些行与本次写入的媒体文件；不发起任何生成请求。
 */
const fs = require('node:fs/promises')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', '..')
const PREFIX = '__review_common_'
const IMAGE_FIXTURE = path.join(ROOT, 'resources/icons/icon.png')
const VIDEO_FIXTURE = path.join(ROOT, 'scripts/fixtures/plain_video.mp4')
const FILE_KINDS = Object.freeze(['image', 'images', 'video', 'audio', 'missing', 'none'])
const MEDIA_TYPES = Object.freeze(['image', 'video', 'audio'])
const STATUSES = Object.freeze(['success', 'error'])

/** 3 秒 8kHz 单声道 PCM：振幅起伏的低音量正弦（测试实例已静音），让波形有可见起伏。 */
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

/** 步骤参数规范化：`{ rows: [{ id, type, file, prompt?, status?, error? }] }`。 */
function normalizeSeedHistory(value) {
  const rows = value?.rows
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('seedHistory 需要非空 rows')
  return {
    rows: rows.map((row, index) => {
      if (!row || !/^[a-z0-9-]+$/.test(String(row.id ?? ''))) throw new Error(`seedHistory.rows[${index}].id 只能是小写字母、数字、连字符`)
      if (!MEDIA_TYPES.includes(row.type)) throw new Error(`seedHistory.rows[${index}].type 只能是 ${MEDIA_TYPES.join('、')}`)
      const file = row.file ?? (row.status === 'error' ? 'none' : row.type)
      if (!FILE_KINDS.includes(file)) throw new Error(`seedHistory.rows[${index}].file 只能是 ${FILE_KINDS.join('、')}`)
      const status = row.status ?? 'success'
      if (!STATUSES.includes(status)) throw new Error(`seedHistory.rows[${index}].status 只能是 ${STATUSES.join('、')}`)
      return { id: row.id, type: row.type, file, status, prompt: String(row.prompt ?? row.id), error: row.error ? String(row.error) : null }
    }),
  }
}

/**
 * 写入夹具并重载渲染层让生成记录读到它们。返回 `{ prefix, cleanup }`；
 * 定位记录卡片用 `[data-generation-task-id="__review_common_<id>"]`。
 */
async function seedHistoryFixture(page, context, { rows }) {
  await context.setupGeneration(page)
  const imageBytes = [...await fs.readFile(IMAGE_FIXTURE)]
  const videoBytes = [...await fs.readFile(VIDEO_FIXTURE)]
  const waveBytes = [...createWaveFixture()]
  const written = await page.evaluate(async ({ prefix, rows, imageBytes, videoBytes, waveBytes }) => {
    const image = await window.henjiNative.image.persistImageBinary(new Uint8Array(imageBytes), 'png')
    const video = image.replace(/\.[^.]+$/, '-common-review.mp4')
    const audio = image.replace(/\.[^.]+$/, '-common-review.wav')
    await window.henjiNative.fs.writeFile(video, new Uint8Array(videoBytes))
    await window.henjiNative.fs.writeFile(audio, new Uint8Array(waveBytes))
    // 不存在的长路径：复制、打开所在位置等动作走正式失败提示
    const missing = image.replace(/[^\\/]+$/, `${'一个名字很长的已被移动或删除的生成结果文件'.repeat(3)}.png`)
    // 多个结果是路径数组；经正式生成记录接口造数据（存储底座 2.3 起渲染层不执行 SQL）。
    const files = { image: [image], images: [image, image, image, image], video: [video], audio: [audio], missing: [missing], none: [] }
    const history = window.henjiNative.generationHistory
    const stale = (await history.list({ idPrefix: prefix })).map(record => record.id)
    if (stale.length) await history.deleteMany(stale)
    await history.insertMany(rows.map((row, index) => ({
      id: `${prefix}${row.id}`, providerId: 'kie', modelId: 'kie-z-image', type: row.type, prompt: row.prompt, params: {},
      resultPaths: files[row.file], taskId: null, status: row.status,
      errorMessage: row.status === 'error' ? (row.error ?? '供应商返回：内容审核未通过，请调整提示词后重试。') : null,
      cost: null, duration: null, createdAt: new Date(Date.now() - (rows.length - index) * 60000).toISOString(),
    })))
    return { image, video, audio }
  }, { prefix: PREFIX, rows, imageBytes, videoBytes, waveBytes })
  // 重载时去掉之前步骤留在地址里的一次性开发参数（页面定位、更新预览），否则重载会重新打开设置等界面
  const url = new URL(page.url())
  for (const key of ['henjiDevSurface', 'henjiDevMedia', 'henjiDevUpdatePreview']) url.searchParams.delete(key)
  await page.goto(url.toString(), { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => Boolean(window.henjiNative), null, { timeout: 30000 })
  await page.locator(`[data-generation-task-id="${PREFIX}${rows[rows.length - 1].id}"]`).first()
    .waitFor({ state: 'attached', timeout: 20000 })
  await context.settlePage(page)
  return {
    prefix: PREFIX,
    cleanup: async () => {
      await page.evaluate(async ({ prefix, written }) => {
        const history = window.henjiNative.generationHistory
        const ids = (await history.list({ idPrefix: prefix })).map(record => record.id)
        if (ids.length) await history.deleteMany(ids)
        for (const file of [written.video, written.audio]) {
          await window.henjiNative.fs.remove(file).catch(() => undefined)
        }
      }, { prefix: PREFIX, written }).catch(() => undefined)
    },
  }
}

module.exports = { PREFIX, createWaveFixture, normalizeSeedHistory, seedHistoryFixture }
