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
          // No result page: stopping lands in the editor with the recording already on a timeline.
          const editor = page.locator('[data-application-surface-id="workspace.video_edit"]')
          await editor.getByRole('button', { name: '录制', exact: true }).waitFor({ state: 'visible', timeout: 60000 })
          const meta = (await list('screen_recording')).find(document => document.name === name)
          assert(meta, '会话未进入文档列表')
          const result = await read(meta.id)
          fs.writeFileSync(path.join(output, `${name}.json`), JSON.stringify(result, null, 2))
          assert.equal(result.content.status, 'stopped')
          assert(Number.isInteger(result.content.startUs) && result.content.endUs > result.content.startUs, '会话没有记下正式开始与结束')
          assert(result.content.media.some(media => media.kind === 'screen' && media.durationUs > 0))
          assert(result.content.media.some(media => media.kind === 'microphone' && media.durationUs > 0))
          assert(result.content.eventPages.length > 0)
          assert(result.content.markers.some(marker => marker.note === '重点演示'))
          assert(result.content.tracks.tracks.find(track => track.kind === 'microphone').gaps.some(gap => gap.reason === 'pause'))
          const screen = result.content.media.filter(media => media.kind === 'screen' && media.durationUs > 0)
          assert(screen.length > 1, '验收录制未形成多个屏幕分片')
          const target = result.content.compositions.at(-1)
          assert(target, '会话没有记住它进入的剪辑')
          const edit = await read(target.documentId)
          const sequence = edit.content.sequences.find(sequence => sequence.id === target.compositionId)
          assert(sequence, '剪辑里找不到录制所在的序列')
          const fps = sequence.frameRate.numerator / sequence.frameRate.denominator
          const clipOf = media => {
            const imported = edit.content.media.find(item => item.path === media.path)
            const item = imported && edit.content.items.find(item => item.mediaId === imported.id)
            return item ? sequence.clips.filter(clip => clip.itemId === item.id) : []
          }
          const screenClips = screen.flatMap(clipOf), micClips = result.content.media.filter(media => media.kind === 'microphone').flatMap(clipOf)
          assert(screenClips.length && micClips.length, '屏幕或麦克风没有进入时间线')
          const first = Math.min(...sequence.clips.filter(clip => clip.linkId === screenClips[0].linkId).map(clip => clip.start))
          const span = clips => [Math.min(...clips.map(clip => clip.start)) - first, Math.max(...clips.map(clip => clip.start + clip.duration)) - first]
          // Picture and sound share one start and one end; nothing before the countdown ended, nothing after stop.
          const [pictureSpan, soundSpan] = [span(screenClips), span(micClips)]
          // The microphone's last audio block (about a tenth of a second) may still be in flight when stop is pressed.
          assert(pictureSpan[0] === 0 && Math.abs(soundSpan[0]) <= 1 && soundSpan[1] <= pictureSpan[1] + 1 && soundSpan[1] >= pictureSpan[1] - fps * 0.25, `画面与声音起止不一致：${JSON.stringify({ pictureSpan, soundSpan })}`)
          // Pauses cut every track at the same moments: no sound without picture after resuming.
          const pictureClips = screenClips.map(clip => [clip.start - first, clip.start + clip.duration - first]).sort((a, b) => a[0] - b[0])
          for (const clip of micClips) assert(pictureClips.some(([start, end]) => clip.start - first >= start - 1 && clip.start + clip.duration - first <= end + 1), `声音出现在没有画面的时间：${JSON.stringify({ sound: [clip.start - first, clip.start + clip.duration - first], pictureClips })}`)
          assert(Math.abs((span(screenClips)[1] - span(screenClips)[0]) / fps - (result.content.endUs - result.content.startUs) / 1e6) < 1.2, '时间线时长与录制区间不符（暂停段除外误差过大）')
          assert(screenClips.every(clip => clip.effects?.some(effect => effect.builtin?.id === 'recording_cursor')), '屏幕片段没有默认重绘光标')
          assert(edit.content.media.find(item => item.path === screen[0].path)?.recordingCursor, '屏幕素材没有挂上光标日志')
          previews.push({ name, fps, screen: span(screenClips), microphone: span(micClips) })
          return { ...result, edit, sequence }
        }
        const toolbox = await record('工具箱录制验收')
        assert.equal(toolbox.sequence.width, 1920); assert.equal(toolbox.sequence.frameRate.numerator, 60)
        await page.screenshot({ path: path.join(output, 'toolbox.png') })
        await capture('recording-session-toolbox')
        // Start the next recording from inside this edit: it comes back into the same project and sequence.
        await page.locator('[data-application-surface-id="workspace.video_edit"]').getByRole('button', { name: '录制', exact: true }).click()
        const editing = await record('剪辑录制验收')
        assert.equal(editing.meta.container.projectId, toolbox.edit.meta.container.projectId)
        assert.equal(editing.edit.meta.id, toolbox.edit.meta.id, '从剪辑发起的录制没有回到原剪辑')
        fs.writeFileSync(path.join(output, 'editing-document.json'), JSON.stringify(editing.edit, null, 2))
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
        fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify({ toolbox: toolbox.meta, editing: editing.meta, media: editing.content.media, events: editing.content.eventPages.length, previews, mcp: { started, stopped, completed }, devices: 'Chromium virtual default microphone', backend: editing.content.source.cursorEmbedded ? 'chromium' : 'gfxcapture' }, null, 2))
      } finally {
        await client?.close().catch(() => {})
        await disableMcp(page).catch(() => {})
        await page.evaluate(async () => { const state = await window.henjiNative.screenRecording.snapshot(); if (state) await window.henjiNative.screenRecording.capture({ operation: 'close', sessionId: state.sessionId }) }).catch(() => {})
      }
    },
  }
}
module.exports = { createRecordingSessionScene }
