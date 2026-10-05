const assert = require('node:assert/strict')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const sharp = require('sharp')
const { captureInspectionPage } = require('./uiInspectionCapture.cjs')

const VIDEO_FIXTURE = path.resolve('scripts/fixtures/plain_video.mp4')
const HISTORY_ID = '__ui_video_viewer_trim'

/**
 * 生成记录里“输入视频”带裁剪选区时，视频查看器进度条上要画出选区高亮（界面重设计 4.2）。
 * 修复前背景写成 `rgba(var(--text-rgb),0.25)`（变量是空格分隔三元组，整条声明无效），高亮从未显示。
 * 5.9 起选区改用主题令牌（`bg-text1/30`，跟随预设明暗），判据改为按正式截屏像素判定“选区与轨道一眼可分”：
 * 选区中部与选区外轨道的亮度对比度 ≥ SELECTION_MIN_CONTRAST，石墨与纸白都要成立（`--theme-preset graphite,paper`）。
 */
const SELECTION_MIN_CONTRAST = 1.5

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
        await page.evaluate((id) => window.henjiNative.db.execute('DELETE FROM history WHERE id = ?', [id]), HISTORY_ID)
      } finally {
        await fsp.rm(current.filePath, { force: true })
      }
    },
    setup: async (page, app) => {
      await openWorkspace(page, 'generation')
      // 生成记录的相对路径以用户目录为基准（唯一来源 electron/main/services/appPaths.ts）。
      const directories = await page.evaluate(() => window.henjiNative.paths.appDirectories())
      const name = `ui-viewer-trim-${randomUUID()}.mp4`
      const relativePath = `${directories.folderNames.uploads}/${name}`
      const filePath = path.join(directories.userRoot, relativePath)
      await fsp.mkdir(path.dirname(filePath), { recursive: true })
      await fsp.copyFile(VIDEO_FIXTURE, filePath)
      fixture = { filePath }
      // 夹具视频 2 s，选区 0.5–1.5 s：高亮应占进度条中间一半。
      const params = { uploadedVideoFilePaths: [relativePath], uploadedVideoTrimStart: 0.5, uploadedVideoTrimEnd: 1.5 }
      await page.evaluate(async ({ id, params }) => {
        await window.henjiNative.db.execute('DELETE FROM history WHERE id = ?', [id])
        await window.henjiNative.db.execute(
          'INSERT INTO history (id,provider_id,model_id,type,prompt,params,file_path,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
          [id, 'kie', 'kie-seedance-2.0', 'video', '裁剪选区查看器验收', JSON.stringify(params), null, 'failed', new Date().toISOString()],
        )
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
      // 选区元素还没有专用 data-* 钩子（已登记交 5.9 补 data-video-trim-range），暂按其唯一的绝对定位层定位
      const highlight = progress.locator('.pointer-events-none.absolute.inset-y-0')
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
      await progress.hover()
      await settlePage(page, 400)
    },
  }
}

module.exports = { SELECTION_MIN_CONTRAST, averageColor, contrastRatio, createGenerationVideoViewerTrimScene }
