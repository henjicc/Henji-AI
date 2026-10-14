const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

/** Quick mode end to end: real capture of the isolated window, one MP4 saved on stop, pointer data inside it. */
function createRecordingQuickScene() {
  return { id: 'recording-quick', name: '屏幕录制-快速模式直接保存视频', surface: '屏幕录制', writesUserData: true,
    launchArgs: ['--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    setup: async (page, app, { capture }) => {
      const { ffprobePath } = require('./mediaBinaries.cjs')
      const button = name => page.getByRole('button', { name, exact: true })
      await button('工具').click(); await page.getByText('屏幕录制', { exact: true }).first().click()
      const sourceId = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().includes('view=')).getMediaSourceId())
      const source = (await page.evaluate(() => window.henjiNative.screenRecording.sources())).find(value => value.id === sourceId)
      assert(source, '隔离应用窗口必须可采集')
      await page.getByRole('radio', { name: '单个窗口', exact: true }).click()
      await button(source.name).click()
      await page.getByRole('radio', { name: '快速', exact: true }).click()
      assert.equal(await page.getByRole('switch', { name: '摄像头', exact: true }).count(), 0, '快速模式不应提供摄像头')
      await page.getByLabel('会话名称', { exact: true }).fill('快速模式验收')
      await capture('recording-quick-setup')
      await button('开始录制').click(); await button('暂停').waitFor({ timeout: 30000 })
      for (let index = 0; index < 4; index++) { await page.mouse.move(300 + index * 120, 300 + index * 40, { steps: 8 }); await page.waitForTimeout(800) }
      await page.getByLabel('标记备注', { exact: true }).fill('快速标记'); await button('打标记').click()
      await page.waitForTimeout(1500)
      const stopped = Date.now()
      await button('停止并保存').click()
      // No result page: a toast names the saved file and offers to show it in its folder.
      const toast = page.getByRole('status').filter({ hasText: '已保存视频' })
      await toast.waitFor({ timeout: 60000 })
      assert.equal(await toast.getByRole('button', { name: '在文件夹中显示', exact: true }).count(), 1, '提示里没有“在文件夹中显示”')
      await capture('recording-quick-toast')
      const savedMs = Date.now() - stopped
      const saved = await page.evaluate(async () => (await window.henjiNative.logging.queryLogEvents({ date: new Date().toISOString().slice(0, 10), level: 'info', keyword: 'recording.quick_export.completed', limit: 1 })).events[0])
      const file = saved?.context?.file
      assert(file && (await toast.textContent()).includes(path.basename(file)), `提示里的文件名与保存的文件不符：${file}`)
      assert(fs.existsSync(file), `快速模式视频不存在：${file}`)
      const probe = JSON.parse(execFileSync(ffprobePath, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { windowsHide: true }).toString())
      assert(probe.streams.some(stream => stream.codec_type === 'video'), '缺少画面')
      assert(probe.streams.some(stream => stream.codec_type === 'audio'), '缺少声音')
      assert(Number(probe.format.duration) > 3, `视频过短：${probe.format.duration}`)
      const bytes = fs.readFileSync(file)
      assert(bytes.includes(Buffer.from('6b8f2a1c4d3e4f5a9b0c7d1e2f3a4b5c', 'hex')), '视频里没有写入鼠标数据')
      const recording = (await page.evaluate(() => window.henjiNative.documents.listDocuments({ kind: 'screen_recording', includeDrafts: true }))).find(value => value.name === '快速模式验收')
      const document = await page.evaluate(id => window.henjiNative.documents.readDocument({ id }), recording.id)
      assert.equal(document.content.source.cursorEmbedded, true, '快速模式必须把鼠标录进画面')
      fs.writeFileSync(path.resolve('node_modules/.cache/recording-quick.json'), JSON.stringify({ file, savedMs, duration: probe.format.duration, size: bytes.length }, null, 2))
      await capture('recording-quick-result')
    },
  }
}

module.exports = { createRecordingQuickScene }
