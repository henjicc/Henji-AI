const assert = require('node:assert/strict')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const sharp = require('sharp')
const { captureInspectionPage } = require('./uiInspectionCapture.cjs')
const { CONTRAST_GRAPHIC_MIN } = require('./uiContrastAudit.cjs')

const VIDEO_FIXTURE = path.resolve('scripts/fixtures/plain_video.mp4')
const HISTORY_ID = '__ui_video_viewer_trim'

/**
 * 生成记录里“输入视频”带裁剪选区时，视频查看器进度条上要画出选区高亮（界面重设计 4.2）。
 * 修复前背景写成 `rgba(var(--text-rgb),0.25)`（变量是空格分隔三元组，整条声明无效），高亮从未显示。
 * K09b 保留 `bg-text1/65` 填充，两端改用 text1 + on-accent 双色实线，保证进度叠加后仍可辨。
 * 查看器只显示已保存的范围，没有可拖裁剪手柄；悬停圆点是播放头，不是裁剪手柄。
 * 未播放轨道上的填充与两端边界分别要求 ≥ SELECTION_MIN_CONTRAST，四预设都要成立（`--theme-preset all`）。
 */
const SELECTION_MIN_CONTRAST = CONTRAST_GRAPHIC_MIN

function relativeLuminance([r, g, b]) {
  const channel = (value) => {
    const c = value / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrastRatio(a, b) {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

/** 轨道截图里 [起, 止) 比例区间的平均颜色（只取竖直中间三分之一，避开圆角）。 */
function averageColor(image, fromRatio, toRatio) {
  const { data, info } = image
  const x0 = Math.floor(info.width * fromRatio)
  const x1 = Math.max(x0 + 1, Math.floor(info.width * toRatio))
  const y0 = Math.floor(info.height / 3)
  const y1 = Math.max(y0 + 1, Math.ceil((info.height * 2) / 3))
  const sum = [0, 0, 0]
  let count = 0
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const offset = (y * info.width + x) * info.channels
      for (let c = 0; c < 3; c += 1) sum[c] += data[offset + c]
      count += 1
    }
  }
  return sum.map((value) => Math.round(value / count))
}

/**
 * 每端有两条 2 DIP 实线：外侧 on-accent、内侧 text1。
 * 双色标记只需其中一条与邻接背景可辨；分别取实线中部，不把两色平均成不存在的颜色。
 * 即使外侧与背景接近，内侧仍由外侧包围而形成清晰边界。返回实际可辨一侧的颜色与对比度。
 */
function sampleTrimBoundary(image, edge, direction, barWidth, adjacent) {
  const stripes = [1, 3].map(offset => {
    const center = edge + direction * offset / barWidth
    const color = averageColor(image, center - 0.25 / barWidth, center + 0.25 / barWidth)
    return { color, ratio: contrastRatio(color, adjacent), stripe: offset === 1 ? 'on-accent' : 'text1' }
  })
  return stripes.reduce((best, stripe) => stripe.ratio > best.ratio ? stripe : best)
}
function createGenerationVideoViewerTrimScene({ openWorkspace, settlePage }) {
  let fixture = null
  return {
    id: 'generation-video-viewer-trim', surface: '生成', name: '生成-输入视频查看器裁剪选区', writesUserData: true,
    cleanup: async (page) => {
      const current = fixture
      fixture = null
      if (!current) return
      await page.keyboard.press('Escape').catch(() => undefined)
      try {
        await page.evaluate((id) => window.henjiNative.generationHistory.delete(id), HISTORY_ID)
      } finally {
        await fsp.rm(current.filePath, { force: true })
      }
    },
    setup: async (page, app) => {
      await openWorkspace(page, 'generation')
      // 素材放在作品目录的上传素材文件夹（唯一来源 electron/main/services/appPaths.ts）；
      // 记录里传绝对路径，写入数据库时由主进程换成位置写法（存储底座 2.3）。
      const directories = await page.evaluate(() => window.henjiNative.paths.appDirectories())
      const name = `ui-viewer-trim-${randomUUID()}.mp4`
      const filePath = path.join(directories.folders.uploads, name)
      await fsp.mkdir(path.dirname(filePath), { recursive: true })
      await fsp.copyFile(VIDEO_FIXTURE, filePath)
      fixture = { filePath }
      // 夹具视频 2 s，选区 0.5–1.5 s：高亮应占进度条中间一半。
      const params = { uploadedVideoFilePaths: [filePath], uploadedVideoTrimStart: 0.5, uploadedVideoTrimEnd: 1.5 }
      await page.evaluate(async ({ id, params }) => {
        await window.henjiNative.generationHistory.delete(id)
        await window.henjiNative.generationHistory.insert({ id, providerId: 'kie', modelId: 'kie-seedance-2.0', type: 'video',
          prompt: '裁剪选区查看器验收', params, resultPaths: [], taskId: null, status: 'failed', errorMessage: null, cost: null, duration: null,
          createdAt: new Date().toISOString() })
      }, { id: HISTORY_ID, params })
      await page.reload({ waitUntil: 'domcontentloaded' })
      await openWorkspace(page, 'generation')
      const card = page.locator(`[data-generation-task-id="${HISTORY_ID}"]`)
      await card.waitFor({ state: 'visible', timeout: 15000 })
      const inputVideo = card.locator('video').first()
      await inputVideo.waitFor({ state: 'visible', timeout: 10000 }).catch(async (error) => {
        const html = await card.evaluate((element) => element.outerHTML.slice(0, 1200))
        throw new Error(`生成记录里没有出现输入视频缩略图：${error.message}\n${html}`)
      })
      await inputVideo.click()
      const progress = page.locator('[data-video-progress]')
      await progress.waitFor({ state: 'visible', timeout: 8000 })
      const highlight = progress.locator('[data-video-trim-range]')
      await highlight.waitFor({ state: 'attached', timeout: 5000 })
      const track = highlight.locator('xpath=..')
      const [bar, box] = await Promise.all([track.boundingBox(), highlight.boundingBox()])
      assert.ok(bar && box && Math.abs(box.width / bar.width - 0.5) < 0.02, `选区宽度应为进度条一半：${JSON.stringify({ bar, box })}`)
      // 停在开头，播放进度填充不压在取样区上
      await page.evaluate(() => document.querySelectorAll('video').forEach((video) => { video.pause(); video.currentTime = 0 }))
      await settlePage(page, 300)
      const image = await sharp(await captureInspectionPage(app, page, { clip: bar })).removeAlpha().raw()
        .toBuffer({ resolveWithObject: true })
      const start = (box.x - bar.x) / bar.width
      const end = (box.x + box.width - bar.x) / bar.width
      const inside = averageColor(image, start + (end - start) * 0.3, start + (end - start) * 0.7)
      const outside = averageColor(image, end + (1 - end) * 0.3, end + (1 - end) * 0.7)
      const ratio = contrastRatio(inside, outside)
      console.log(`  裁剪选区对比度 ${ratio.toFixed(2)}：选区 rgb(${inside})，轨道 rgb(${outside})`)
      assert.ok(ratio >= SELECTION_MIN_CONTRAST,
        `裁剪选区与轨道不可分：对比度 ${ratio.toFixed(2)}（需 ≥ ${SELECTION_MIN_CONTRAST}），选区 rgb(${inside})，轨道 rgb(${outside})`)
      // 起止边界独立取双色实线像素，不能借用范围填充读数。
      const checkBoundaries = (pixels, state) => {
        for (const [name, edge, direction, adjacentFrom, adjacentTo] of [
          ['起点', start, 1, start * 0.3, start * 0.7],
          ['终点', end, -1, end + (1 - end) * 0.3, end + (1 - end) * 0.7],
        ]) {
          const adjacent = averageColor(pixels, adjacentFrom, adjacentTo)
          const { color: boundary, ratio: boundaryRatio, stripe } = sampleTrimBoundary(pixels, edge, direction, bar.width, adjacent)
          console.log(`  ${state}裁剪${name}边界对比度 ${boundaryRatio.toFixed(2)}：${stripe} 边界 rgb(${boundary})，邻接轨道 rgb(${adjacent})`)
          assert.ok(boundaryRatio >= SELECTION_MIN_CONTRAST,
            `${state}裁剪${name}边界对比度 ${boundaryRatio.toFixed(2)}（需 ≥ ${SELECTION_MIN_CONTRAST}）`)
        }
      }
      checkBoundaries(image, '未播放')
      // 移到范围中部：左边界邻接已播放强调色，右边界仍邻接未播放轨道。
      await page.evaluate(() => document.querySelectorAll('video').forEach((video) => { video.currentTime = 1 }))
      await settlePage(page, 300)
      const playedPercent = await track.locator(':scope > div').first().evaluate((element) => parseFloat(element.style.width))
      assert.ok(Math.abs(playedPercent - 50) < 1, `边界复验前播放进度须进入范围中部：${playedPercent}%`)
      const playedImage = await sharp(await captureInspectionPage(app, page, { clip: bar })).removeAlpha().raw()
        .toBuffer({ resolveWithObject: true })
      checkBoundaries(playedImage, '进度叠加后')
      await progress.hover()
      await settlePage(page, 400)
    },
  }
}

module.exports = { SELECTION_MIN_CONTRAST, averageColor, contrastRatio, sampleTrimBoundary, createGenerationVideoViewerTrimScene }
