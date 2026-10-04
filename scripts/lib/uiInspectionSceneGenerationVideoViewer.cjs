const assert = require('node:assert/strict')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

const VIDEO_FIXTURE = path.resolve('scripts/fixtures/plain_video.mp4')
const HISTORY_ID = '__ui_video_viewer_trim'

/**
 * 生成记录里“输入视频”带裁剪选区时，视频查看器进度条上要画出选区高亮（界面重设计 4.2）。
 * 修复前背景写成 `rgba(var(--text-rgb),0.25)`（变量是空格分隔三元组，整条声明无效），高亮从未显示。
 */
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
    setup: async (page) => {
      await openWorkspace(page, 'generation')
      // 生成记录的相对路径以数据根目录为基准（默认 = appLocalDataDir/Henji-AI，见 src/utils/dataPath.ts getDefaultDataRoot）。
      const dataRoot = path.join(await page.evaluate(() => window.henjiNative.paths.appLocalDataDir()), 'Henji-AI')
      const name = `ui-viewer-trim-${randomUUID()}.mp4`
      const filePath = path.join(dataRoot, 'Uploads', name)
      await fsp.mkdir(path.dirname(filePath), { recursive: true })
      await fsp.copyFile(VIDEO_FIXTURE, filePath)
      fixture = { filePath }
      // 夹具视频 2 s，选区 0.5–1.5 s：高亮应占进度条中间一半。
      const params = { uploadedVideoFilePaths: [`Uploads/${name}`], uploadedVideoTrimStart: 0.5, uploadedVideoTrimEnd: 1.5 }
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
      const progress = page.locator('.progress-container')
      await progress.waitFor({ state: 'visible', timeout: 8000 })
      const highlight = progress.locator('.pointer-events-none.absolute.inset-y-0')
      await highlight.waitFor({ state: 'attached', timeout: 5000 })
      const background = await highlight.evaluate((element) => getComputedStyle(element).backgroundColor)
      assert.match(background, /^rgba\(255, 255, 255, 0\.25\)$/, `裁剪选区高亮应为 25% 白（媒体叠层），实际 ${background}`)
      const [bar, box] = await Promise.all([progress.boundingBox(), highlight.boundingBox()])
      assert.ok(bar && box && Math.abs(box.width / bar.width - 0.5) < 0.02, `选区宽度应为进度条一半：${JSON.stringify({ bar, box })}`)
      await progress.hover()
      await settlePage(page, 400)
    },
  }
}

module.exports = { createGenerationVideoViewerTrimScene }
