const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

/**
 * Picture timing measured on real capture: the recorded window turns black/white exactly on every 500 ms of the
 * wall clock. Each flip found in the saved file is mapped back through the session clock; the difference is how
 * far the file's picture time is from when the screen really changed (positive = picture shown late).
 */
function createRecordingSyncScene() {
  return { id: 'recording-sync', name: '屏幕录制-画面时间准确度', surface: '屏幕录制', writesUserData: true,
    launchArgs: ['--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    setup: async (page, app, { capture }) => {
      const { ffmpegPath } = require('./mediaBinaries.cjs')
      const button = name => page.getByRole('button', { name, exact: true })
      await button('工具').click(); await page.getByText('屏幕录制', { exact: true }).first().click()
      const sourceId = await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().includes('view=')); window.setTitle(`录屏验收-${process.pid}`); return window.getMediaSourceId() })
      await button('刷新来源').click()
      const source = (await page.evaluate(() => window.henjiNative.screenRecording.sources())).find(value => value.id === sourceId)
      await page.getByRole('radio', { name: '单个窗口', exact: true }).click()
      await button(source.name).click()
      await page.getByRole('radio', { name: '快速', exact: true }).click()
      await page.getByLabel('会话名称', { exact: true }).fill('画面时间验收')
      const clicked = Date.now()
      await button('开始录制').click()
      // The countdown must be on screen almost at once, not after a long preparation.
      await page.waitForFunction(() => document.body.innerText.includes('秒后开始'), null, { timeout: 5000 })
      const countdownMs = Date.now() - clicked
      await button('暂停').waitFor({ timeout: 30000 })
      const startedMs = Date.now() - clicked
      await page.evaluate(() => {
        const veil = document.createElement('div')
        veil.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none'
        document.body.append(veil)
        const paint = () => { veil.style.background = Math.floor(Date.now() / 500) % 2 ? 'white' : 'black'; requestAnimationFrame(paint) }
        paint()
      })
      await page.waitForTimeout(5200)
      const clock = await app.evaluate(() => ({ hrUs: Number(process.hrtime.bigint() / 1000n), dateMs: Date.now() }))
      await page.evaluate(() => document.querySelector('body > div[style*="2147483647"]')?.remove())
      await button('停止并保存').click()
      // No result page: a toast names the saved file and offers to show it in its folder.
      const toast = page.getByRole('status').filter({ hasText: '已保存视频' })
      await toast.waitFor({ timeout: 60000 })
      assert.equal(await toast.getByRole('button', { name: '在文件夹中显示', exact: true }).count(), 1, '提示里没有“在文件夹中显示”')
      const saved = await page.evaluate(async () => (await window.henjiNative.logging.queryLogEvents({ date: new Date().toISOString().slice(0, 10), level: 'info', keyword: 'recording.quick_export.completed', limit: 1 })).events[0])
      const file = saved?.context?.file
      assert(file && (await toast.textContent()).includes(path.basename(file)), `提示里的文件名与保存的文件不符：${file}`)
      const recording = (await page.evaluate(() => window.henjiNative.documents.listDocuments({ kind: 'screen_recording', includeDrafts: true }))).find(value => value.name === '画面时间验收')
      const { content } = await page.evaluate(id => window.henjiNative.documents.readDocument({ id }), recording.id)
      assert(Number.isInteger(content.startUs) && Number.isInteger(content.endUs), '会话必须记下正式开始与结束时刻')
      const log = spawnSync(ffmpegPath, ['-hide_banner', '-i', file, '-map', '0:v', '-vf', 'scale=64:36,format=gray,showinfo', '-f', 'null', '-'], { windowsHide: true }).stderr.toString()
      const frames = [...log.matchAll(/pts_time:([\d.]+).*?mean:\[(\d+)/g)].map(match => ({ t: Number(match[1]), luma: Number(match[2]) }))
      // File time t → session clock → wall clock.
      const toDate = t => clock.dateMs - (clock.hrUs - (content.originUs + content.startUs + t * 1e6)) / 1000
      const offsets = []
      for (let index = 1; index < frames.length; index++) {
        const before = frames[index - 1].luma > 128, after = frames[index].luma > 128
        if (before === after) continue
        const shown = toDate(frames[index].t)
        offsets.push(Math.round(shown - Math.round(shown / 500) * 500))
      }
      assert(offsets.length >= 6, `检测到的翻转太少：${offsets.length}`)
      const sorted = [...offsets].sort((a, b) => a - b), median = sorted[sorted.length >> 1]
      const after = new Date(clicked - 1000).toISOString()
      const logs = await page.evaluate(async afterTimestamp => (await window.henjiNative.logging.queryLogEvents({ date: afterTimestamp.slice(0, 10), afterTimestamp, level: 'info', limit: 1000 })).events.reverse(), after)
      const timeline = logs.filter(event => /recording|media\.permission|documents\.create/.test(event.event)).slice(0, 40).map(event => `${Date.parse(event.timestamp) - clicked}ms ${event.event}`)
      const result = { timeline, countdownMs, startedMs, flips: offsets.length, medianMs: median, offsets, startUs: content.startUs, endUs: content.endUs, fileDuration: frames.at(-1)?.t, file }
      fs.writeFileSync(path.resolve('node_modules/.cache/recording-sync.json'), JSON.stringify(result, null, 2))
      assert(countdownMs < 1500, `点开始后 ${countdownMs}ms 才出现倒计时`)
      await capture('recording-sync-result')
    },
  }
}

module.exports = { createRecordingSyncScene }
