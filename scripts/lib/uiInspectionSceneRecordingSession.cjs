const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope } = require('./uiInspectionMcpClient.cjs')

function createRecordingSessionScene() {
  return {
    id: 'recording-session', name: '屏幕录制-工具箱与剪辑完整会话', surface: '屏幕录制', writesUserData: true,
    launchArgs: ['--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    setup: async (page, app, { capture }) => {
      const output = path.resolve('.ui-tour/recording-session'); fs.mkdirSync(output, { recursive: true })
      const button = name => page.getByRole('button', { name, exact: true })
      const list = kind => page.evaluate(kind => window.henjiNative.documents.listDocuments({ kind, includeDrafts: true, includeMissing: false }), kind)
      const read = id => page.evaluate(id => window.henjiNative.documents.readDocument({ id }), id)
      let client
      try {
        await button('工具').click()
        await page.getByText('屏幕录制', { exact: true }).first().click()
        await page.getByTestId('screen-recording-page').waitFor({ state: 'visible' })
        // Record only this isolated test application's window, never another app or the desktop.
        const sourceId = await app.evaluate(({ BrowserWindow }) => {
          const window = BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().includes('view='))
          return window.getMediaSourceId()
        })
        const source = (await page.evaluate(() => window.henjiNative.screenRecording.sources())).find(source => source.id === sourceId)
        assert(source, '未枚举到隔离测试应用窗口')
        const record = async name => {
          await page.getByRole('button', { name: source.name, exact: true }).click()
          await page.getByLabel('会话名称', { exact: true }).fill(name)
          if (name === '工具箱录制验收') {
            await page.screenshot({ path: path.join(output, 'preparation.png') })
            await capture('recording-session-preparation')
          }
          await button('开始录制').click()
          await button('暂停').waitFor({ state: 'visible', timeout: 25000 })
          await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === '暂停' && !button.disabled))
          await page.waitForTimeout(5000)
          await page.getByLabel('标记备注', { exact: true }).fill('重点演示')
          await button('打标记').click()
          await button('暂停').click()
          await page.waitForTimeout(600)
          await button('继续').click()
          await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === '暂停' && !button.disabled))
          await page.waitForTimeout(5000)
          assert((await page.evaluate(() => window.henjiNative.screenRecording.snapshot())).elapsedMs >= 10000, '未录满十秒')
          await button('停止并保存').click()
          await button('新建录制').waitFor({ state: 'visible', timeout: 30000 })
          await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === '新建录制' && !button.disabled), null, { timeout: 30000 })
          await page.waitForFunction(() => document.querySelector('[data-testid="recording-preview"]')?.readyState >= 1)
          await page.getByTestId('recording-preview').evaluate(video => video.play())
          await page.waitForFunction(() => { const video = document.querySelector('[data-testid="recording-preview"]'); return video && video.currentTime > 0.3 && video.readyState >= 2 && !video.error }, null, { timeout: 15000 })
          await page.getByTestId('recording-preview').evaluate(video => video.pause())
          const meta = (await list('screen_recording')).find(document => document.name === name)
          assert(meta, '会话未进入文档列表')
          const result = await read(meta.id)
          fs.writeFileSync(path.join(output, `${name}.json`), JSON.stringify(result, null, 2))
          assert.equal(result.content.status, 'stopped')
          assert(result.content.media.some(media => media.kind === 'screen' && media.durationUs > 0))
          assert(result.content.media.some(media => media.kind === 'microphone' && media.durationUs > 0))
          assert(result.content.eventPages.length > 0)
          assert(result.content.markers.some(marker => marker.note === '重点演示'))
          assert(result.content.tracks.tracks.find(track => track.kind === 'microphone').gaps.some(gap => gap.reason === 'pause'))
          return result
        }
        const toolbox = await record('工具箱录制验收')
        await page.screenshot({ path: path.join(output, 'toolbox.png') })
        await capture('recording-session-toolbox')
        await button('送入新剪辑项目').click()
        await button('录制').waitFor({ state: 'visible', timeout: 30000 })
        const editors = await list('video_edit'); assert.equal(editors.length, 1)
        const before = await read(editors[0].id)
        assert(before.content.sequences[0].clips.length > 0)
        await button('录制').click()
        const editing = await record('剪辑录制验收')
        assert.equal(editing.meta.container.projectId, editors[0].container.projectId)
        const after = await read(editors[0].id)
        fs.writeFileSync(path.join(output, 'editing-document.json'), JSON.stringify(after, null, 2))
        assert(after.content.items.length > before.content.items.length)
        const added = after.content.sequences[0].clips.filter(clip => !before.content.sequences[0].clips.some(previous => previous.id === clip.id))
        const origin = Math.min(...editing.content.media.filter(media => media.durationUs > 0).map(media => media.monoUs))
        const fps = after.content.sequences[0].frameRate.numerator / after.content.sequences[0].frameRate.denominator
        for (const media of editing.content.media.filter(media => media.durationUs > 0)) {
          const imported = after.content.media.find(item => item.path === media.path)
          assert(imported, '媒体引用未进入原项目')
          const item = after.content.items.find(item => item.mediaId === imported.id)
          const clip = added.find(clip => clip.itemId === item.id)
          assert(clip, '录制片段未落入绑定序列')
          assert(Math.abs(clip.start - (media.monoUs - origin) * fps / 1e6) <= 1, `对齐误差超过一帧：${media.kind} start=${clip.start} target=${(media.monoUs - origin) * fps / 1e6}`)
        }
        const identity = await authorizeMcpConnection(page, { name: '录制会话回读', allowWrites: true })
        client = await connectMcpClient(identity.config, 'Henji recording session')
        const events = await callTool(client, 'read_screen_recording_events', { sessionRef: { kind: 'screen_recording.session', id: editing.meta.id }, limit: 2 })
        assert(events.data.events.length === 2 && events.data.nextOffset !== null, 'MCP 事件分页失败')
        await page.screenshot({ path: path.join(output, 'editing.png') })
        await capture('recording-session-editing')
        const sourceRef = { kind: 'screen_recording.source', id: sourceId }
        const sourceBaseline = await callTool(client, 'read_application_entity', { ref: sourceRef })
        const started = await callTool(client, 'start_screen_recording', operationEnvelope([sourceBaseline], { sourceRef, name: 'MCP 录制验收', tracks: { microphone: {}, systemAudio: false } }))
        const sessionRef = started.result.data.resultRef
        const deadline = Date.now() + 20000
        while ((await page.evaluate(() => window.henjiNative.screenRecording.snapshot()))?.phase !== 'recording' && Date.now() < deadline) await page.waitForTimeout(50)
        assert.equal((await page.evaluate(() => window.henjiNative.screenRecording.snapshot()))?.phase, 'recording')
        await page.waitForTimeout(1100)
        const sessionBaseline = await callTool(client, 'read_application_entity', { ref: sessionRef })
        const stopped = await callTool(client, 'stop_screen_recording', operationEnvelope([sessionBaseline], { sessionRef }))
        assert(stopped.result.data.verified, 'MCP 停止没有持久化证据')
        const completed = await callTool(client, 'read_application_entity', { ref: sessionRef })
        assert.equal(completed.data.properties['screen_recording.session.phase'], 'stopped')
        fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify({ toolbox: toolbox.meta, editing: editing.meta, media: editing.content.media, events: editing.content.eventPages.length, clips: added, mcp: { started, stopped, completed }, devices: 'Chromium virtual default microphone', backend: editing.content.source.cursorEmbedded ? 'chromium' : 'gfxcapture' }, null, 2))
      } finally {
        await client?.close().catch(() => {})
        await disableMcp(page).catch(() => {})
        await page.evaluate(async () => { const state = await window.henjiNative.screenRecording.snapshot(); if (state) await window.henjiNative.screenRecording.capture({ operation: 'close', sessionId: state.sessionId }) }).catch(() => {})
      }
    },
  }
}
module.exports = { createRecordingSessionScene }
