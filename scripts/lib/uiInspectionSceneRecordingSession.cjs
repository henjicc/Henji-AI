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
      const previews = []
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
          if (name === '工具箱录制验收') {
            // Range picker states and the director entry, captured once for visual review.
            await page.getByRole('radio', { name: '整个屏幕', exact: true }).click()
            await capture('recording-session-range-screen')
            await page.getByRole('radio', { name: '选定区域', exact: true }).click()
            await capture('recording-session-range-region')
            await page.getByRole('radio', { name: 'AI导演', exact: true }).click()
            await capture('recording-session-director-goal')
            await page.getByRole('radio', { name: '自己录', exact: true }).click()
          }
          // The isolated app is a window source: pick the window range first, then the window itself.
          await page.getByRole('radio', { name: '单个窗口', exact: true }).click()
          await page.getByRole('button', { name: source.name, exact: true }).click()
          await page.getByLabel('会话名称', { exact: true }).fill(name)
          if (name === '工具箱录制验收') {
            await page.getByRole('switch', { name: '麦克风', exact: true }).click()
            assert.equal(await page.getByLabel('麦克风设备', { exact: true }).count(), 0, '关闭麦克风后仍出现设备选择')
            await page.screenshot({ path: path.join(output, 'preparation-microphone-off.png') })
            await capture('recording-session-microphone-off')
            await page.getByRole('switch', { name: '麦克风', exact: true }).click()
            const captions = await page.evaluate(() => [...document.querySelectorAll('[data-recording-source-caption]')].map(caption => {
              const card = caption.closest('button').getBoundingClientRect(), rect = caption.getBoundingClientRect()
              const image = caption.parentElement.querySelector('[data-recording-source-thumbnail]')?.getBoundingClientRect()
              return { contained: rect.left >= card.left - 0.5 && rect.right <= card.right + 0.5 && rect.top >= card.top - 0.5 && rect.bottom <= card.bottom + 0.5, belowImage: !image || rect.top >= image.bottom - 0.5, rect: [rect.left, rect.top, rect.right, rect.bottom], card: [card.left, card.top, card.right, card.bottom], image: image && [image.top, image.bottom] }
            }))
            assert(captions.length && captions.every(caption => caption.contained && caption.belowImage), `来源标题溢出卡片或与缩略图重叠：${JSON.stringify(captions.filter(caption => !caption.contained || !caption.belowImage).slice(0, 3))}`)
            await page.screenshot({ path: path.join(output, 'preparation.png') })
            await capture('recording-session-preparation')
          }
          await button('开始录制').click()
          await button('暂停').waitFor({ state: 'visible', timeout: 25000 })
          await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === '暂停' && !button.disabled))
          await page.waitForTimeout(5000)
          await page.getByLabel('标记备注', { exact: true }).fill('重点演示')
          await button('打标记').click()
          if (name === '工具箱录制验收') {
            await page.screenshot({ path: path.join(output, 'recording.png') })
            await capture('recording-session-recording')
          }
          await button('暂停').click()
          await page.waitForTimeout(600)
          await button('继续').click()
          await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === '暂停' && !button.disabled))
          await page.waitForTimeout(5000)
          await page.getByLabel('标记备注', { exact: true }).fill('末段定位')
          await button('打标记').click()
          assert((await page.evaluate(() => window.henjiNative.screenRecording.snapshot())).elapsedMs >= 10000, '未录满十秒')
          await button('停止并保存').click()
          await button('新建录制').waitFor({ state: 'visible', timeout: 30000 })
          await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === '新建录制' && !button.disabled), null, { timeout: 30000 })
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
          const media = result.content.media.filter(media => media.durationUs > 0)
          const screen = media.filter(media => media.kind === 'screen').sort((a, b) => a.monoUs - b.monoUs)
          assert(screen.length > 1, '验收录制未形成多个屏幕分片')
          const origin = Math.min(...media.map(media => media.monoUs))
          const duration = (Math.max(...media.map(media => media.monoUs + media.durationUs), ...result.content.markers.map(marker => marker.monoUs)) - origin) / 1e6
          const viewer = page.getByTestId('recording-preview')
          // A track may begin after another one; the initial empty interval is intentionally blank.
          await viewer.waitFor({ state: 'attached' })
          await page.waitForFunction(() => document.querySelector('[data-testid="recording-preview"]')?.readyState >= 1)
          assert.equal(await viewer.evaluate(video => video.controls), false, '会话仍使用浏览器原生控制条')
          assert(Math.abs(Number(await viewer.getAttribute('data-viewer-duration')) - duration) < 1e-6, '预览时长未覆盖全部分片')
          assert.equal(await button('生成成片').count(), 1, '成片入口未显示')
          await page.locator('[data-recording-workbench]').waitFor({ state: 'visible' })
          await viewer.evaluate(video => { video.__tourPlayedSources = []; video.addEventListener('playing', () => video.__tourPlayedSources.push(video.getAttribute('src'))) })
          await button('播放/暂停').click()
          await page.waitForFunction(duration => {
            const video = document.querySelector('[data-testid="recording-preview"]')
            return video && Number(video.dataset.viewerTime) >= duration && !video.error
          }, duration, { timeout: Math.ceil(duration * 1000) + 20000 })
          const crossed = await viewer.evaluate(video => ({ time: Number(video.dataset.viewerTime), playedSources: video.__tourPlayedSources }))
          for (const segment of screen) assert(crossed.playedSources.some(source => source.includes(path.basename(segment.path))), `自动播放跳过分片：${path.basename(segment.path)}`)
          const marker = result.content.markers.find(marker => marker.note === '末段定位')
          const markerTime = (marker.monoUs - origin) / 1e6
          await page.getByRole('button', { name: /末段定位/ }).click()
          await page.waitForFunction(target => {
            const video = document.querySelector('[data-testid="recording-preview"]')
            return video && Math.abs(Number(video.dataset.viewerTime) - target) < 0.001 && video.readyState >= 2 && !video.seeking && !video.error
          }, markerTime, { timeout: 15000 })
          const located = await viewer.evaluate(video => ({ time: Number(video.dataset.viewerTime), sourceTime: video.currentTime, source: video.getAttribute('src') }))
          const segment = screen.find(media => media.monoUs <= marker.monoUs && marker.monoUs < media.monoUs + media.durationUs)
          assert(segment && located.source.includes(path.basename(segment.path)), '末段标记未定位到正确文件')
          assert(Math.abs(located.sourceTime - (marker.monoUs - segment.monoUs) / 1e6) <= 1 / 30, '标记定位误差超过一帧')
          previews.push({ name, duration, screenSegments: screen.length, crossed, located, markerTime })
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
        fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify({ toolbox: toolbox.meta, editing: editing.meta, media: editing.content.media, events: editing.content.eventPages.length, clips: added, previews, mcp: { started, stopped, completed }, devices: 'Chromium virtual default microphone', backend: editing.content.source.cursorEmbedded ? 'chromium' : 'gfxcapture' }, null, 2))
      } finally {
        await client?.close().catch(() => {})
        await disableMcp(page).catch(() => {})
        await page.evaluate(async () => { const state = await window.henjiNative.screenRecording.snapshot(); if (state) await window.henjiNative.screenRecording.capture({ operation: 'close', sessionId: state.sessionId }) }).catch(() => {})
      }
    },
  }
}
module.exports = { createRecordingSessionScene }
