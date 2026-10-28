/* eslint-disable @typescript-eslint/no-var-requires */
const assert = require('node:assert/strict')

async function installImageExplanationFixture(page, app) {
  await app.evaluate(({ ipcMain }) => {
    const handlers = ipcMain._invokeHandlers
    const originals = new Map()
    for (const key of ['audioEdit:explanation', 'ai:getProviderKeyInfo', 'ai:getRuntimeProviderKeyStatus']) originals.set(key, handlers.get(key))
    globalThis.__t157Originals = originals
    globalThis.__t157Transcripts = {}; globalThis.__t157Calls = 0
    ipcMain.removeHandler('audioEdit:explanation')
    ipcMain.handle('audioEdit:explanation', async (event, input) => {
      // bc23e0733 后使用原生 PCM；仅替换外部预检和 ASR，先证明真实录音块存在。
      if (input.action === 'preflight') {
        const read = await originals.get('audioEdit:explanation')(event, { action: 'read', sessionId: input.sessionId, chunkId: input.chunkId })
        if (!read.ok || !read.data || read.data.length <= 44) throw new Error('原生图片讲解录音块未保存')
        return { ok: true, data: undefined }
      }
      if (input.action !== 'transcribe') return originals.get('audioEdit:explanation')(event, input)
      const transcript = globalThis.__t157Transcripts[input.chunkId]
      if (!transcript) throw new Error('Missing zero-cost transcription fixture')
      globalThis.__t157Calls++
      return { ok: true, data: { modelId: input.modelId, providerId: 'bailian', requestId: input.requestId, transcript } }
    })
    ipcMain.removeHandler('ai:getProviderKeyInfo')
    ipcMain.handle('ai:getProviderKeyInfo', async (event, input) => input.providerId === 'bailian' ? { ok: true, data: { configured: true, maskedHint: '••••ture' } } : originals.get('ai:getProviderKeyInfo')(event, input))
    ipcMain.removeHandler('ai:getRuntimeProviderKeyStatus')
    ipcMain.handle('ai:getRuntimeProviderKeyStatus', async event => {
      const result = await originals.get('ai:getRuntimeProviderKeyStatus')(event)
      return { ...result, data: [...result.data.filter(v => v.providerId !== 'bailian'), { providerId: 'bailian', configured: true }] }
    })
  })
  return async () => {
    await page.evaluate(() => window.__t157NativeRelease?.()).catch(() => {})
    await app.evaluate(({ ipcMain }) => { for (const [key, handler] of globalThis.__t157Originals) { ipcMain.removeHandler(key); if (handler) ipcMain.handle(key, handler) } })
  }
}

async function runImageExplanationScene({ page, app, host, read, select, shot, evidence, store }) {
  await page.evaluate(() => {
    window.__t157NativeSessions = new Set()
    window.__t157NativeRelease = window.henjiNative.audioCapture.onSamples(event => window.__t157NativeSessions.add(event.sessionId))
  })
  const trigger = () => host().getByRole('button', { name: '录制讲解', exact: true })
  const controls = () => page.locator('[data-image-explanation-controls]')
  const button = name => page.getByRole('button', { name, exact: true })
  const open = async () => { if (!await controls().isVisible()) await trigger().click() }
  await select(['hero', 'mirror', 'rotate'])
  await open(); await shot('首次录制提示')
  await button('开始录制').click()
  await host().getByRole('button', { name: '暂停图片讲解', exact: true }).waitFor(); await controls().waitFor({ state: 'hidden' }); await shot('开始录制')
  // A harmless hover followed by a down/up on the already-selected subject. The move tool stays untouched.
  const preview = host().locator('[data-preview-surface]')
  const bounds = await preview.boundingBox(); assert.ok(bounds)
  const geometry = await preview.evaluate(e => ({ zoom: Number(e.dataset.previewDisplayZoom), width: Number(e.dataset.previewOutputWidth), height: Number(e.dataset.previewOutputHeight) }))
  const point = { x: bounds.x + bounds.width / 2 + (125 - geometry.width / 2) * geometry.zoom, y: bounds.y + bounds.height / 2 + (175 - geometry.height / 2) * geometry.zoom }
  await page.mouse.move(point.x, point.y); await page.waitForTimeout(700)
  // Use Ctrl to retain the deliberately selected target set; this is a real pointer sample, not injected state.
  await page.keyboard.down('Control'); await page.mouse.down(); await page.waitForTimeout(200); await page.mouse.up(); await page.keyboard.up('Control')
  await page.waitForTimeout(700); await shot('边说边指主图')
  await page.mouse.move(point.x + 18, point.y + 12); await page.waitForTimeout(250); await shot('继续指向序列')
  await host().getByRole('button', { name: '结束图片讲解', exact: true }).click()
  await button('转写并审阅').waitFor({ timeout: 60000 }); await shot('结束并保存讲解')
  const snapshot = await read(), session = snapshot.document.creativeIntents.sessions.at(-1)
  assert.equal(session.mode, 'static'); assert.ok(session.clockSegments.every(c => c.start === null && c.end === null))
  const events = await page.evaluate(async session => {
    const events = []
    for (const ref of session.pages) { const page = await window.henjiNative.imageEditorV3.readLayoutResource({ requestId: crypto.randomUUID(), resourceRef: ref.resourceId }); events.push(...page.entries) }
    return events
  }, session)
  const pointers = events.filter(e => e.kind === 'pointer' && e.phase === 'down' && e.pointedRefs.length)
  assert.ok(pointers.length, '真实图层命中必须进入录制页'); assert.ok(session.visualEvidenceRefs.length, '必须保存真实历史画面')
  for (const visual of session.visualEvidenceRefs) {
    assert.ok(Math.abs(visual.size[0] / visual.size[1] - 2) < .02, '完整可见的 2:1 作品截图不能带入右侧面板')
    const pointer = pointers.find(value => value.seq === visual.frames[0].seq)
    assert.ok(pointer && pointer.compositionPoint.every((value, index) => Math.abs(value - visual.frames[0].pointer[index]) < .004), '历史标记须对齐原作品位置，含 UI 缩放')
  }
  assert.ok(events.every(e => e.timeline === null && e.unavailableReason === 'static'))
  const transcripts = {}
  for (const audio of events.filter(e => e.kind === 'audio')) {
    const pointer = pointers.find(p => p.monoUs >= audio.monoSpanUs[0] && p.monoUs < audio.monoSpanUs[1])
    const duration = (audio.endSample - audio.startSample) * 1000 / audio.sampleRate
    const start = pointer ? Math.max(0, (pointer.monoUs - audio.monoSpanUs[0]) / 1000 - 100) : 0
    const end = Math.min(duration, start + 400)
    transcripts[audio.audioSegmentRef] = { unit: 'ms', text: '这几个等距', granularity: 'word', words: [], segments: [{ text: '这几个等距', granularity: 'word', timing: 'precise', confidence: .99, startMs: start, endMs: end }] }
  }
  await app.evaluate((_electron, transcripts) => { globalThis.__t157Transcripts = transcripts }, transcripts)
  await button('转写并审阅').click(); await button('允许本次').click()
  await button('查看「这几个」的指向').first().waitFor({ timeout: 60000 }); await shot('转写审阅')
  await button('查看「这几个」的指向').first().click()
  await page.getByAltText('指向时保存的作品画面').waitFor({ timeout: 60000 }); await shot('点词回看历史画面和图层')
  assert.doesNotMatch(await controls().innerText(), /\d+(?:\.\d+)?%|位置 \d|对象 \d|还不能生成修改计划|上一页|下一页|候选更新|不会重放/)
  assert.equal(await controls().locator('[data-explanation-evidence]').count(), 1)
  const before = (await read()).document.layers
  await button('生成候选').click(); await controls().waitFor({ state: 'hidden', timeout: 60000 })
  const layout = page.locator('[data-image-layout-controls]')
  await layout.getByRole('radio', { name: '等距排列', exact: true }).waitFor(); await shot('布局候选')
  await layout.getByRole('button', { name: '应用', exact: true }).click(); await layout.getByText('已应用，可撤销', { exact: true }).waitFor(); await shot('一步应用')
  assert.notDeepEqual((await read()).document.layers, before)
  await host().getByRole('button', { name: '随手摆', exact: true }).click()
  await host().getByRole('button', { name: /^(撤销|Undo)$/ }).click(); await shot('一步撤销')
  // Wait for the normal autosave to report the undone pose.
  await page.waitForTimeout(1200); assert.deepEqual((await read()).document.layers, before)
  // A second local recording exercises object + destination through the same layout UI.
  await open(); await button('删除讲解').click(); await button('删除').click()
  await controls().waitFor({ state: 'hidden' })
  for (let attempt = 0; attempt < 100 && (await read()).document.creativeIntents?.sessions.length; attempt++) await page.waitForTimeout(50)
  assert.equal((await read()).document.creativeIntents?.sessions.length, 0, '讲解应完整删除后再录制')
  await open(); await button('开始录制').waitFor(); await button('开始录制').click()
  await host().getByRole('button', { name: '暂停图片讲解', exact: true }).waitFor(); await controls().waitFor({ state: 'hidden' })
  await page.mouse.move(point.x, point.y); await page.keyboard.down('Control'); await page.mouse.down(); await page.waitForTimeout(160); await page.mouse.up(); await page.keyboard.up('Control')
  await page.waitForTimeout(1300)
  const destinationPoint = { x: bounds.x + bounds.width / 2 + (800 - geometry.width / 2) * geometry.zoom, y: bounds.y + bounds.height / 2 + (125 - geometry.height / 2) * geometry.zoom }
  await page.mouse.move(destinationPoint.x, destinationPoint.y); await page.keyboard.down('Control'); await page.mouse.down(); await page.waitForTimeout(160); await page.mouse.up(); await page.keyboard.up('Control')
  await page.waitForTimeout(700); await host().getByRole('button', { name: '结束图片讲解', exact: true }).click(); await button('转写并审阅').waitFor()
  const movementSession = (await read()).document.creativeIntents.sessions.at(-1)
  const movementEvents = await page.evaluate(async session => {
    const events = []
    for (const ref of session.pages) { const page = await window.henjiNative.imageEditorV3.readLayoutResource({ requestId: crypto.randomUUID(), resourceRef: ref.resourceId }); events.push(...page.entries) }
    return events
  }, movementSession)
  const movementPointers = movementEvents.filter(event => event.kind === 'pointer' && event.phase === 'down' && event.compositionPoint)
  const sourcePointer = movementPointers.find(event => event.pointedRefs.some(ref => ref.label === '主图')), destinationPointer = movementPointers.find(event => event.compositionPoint[0] > .7)
  assert.ok(sourcePointer && destinationPointer)
  const movementTranscripts = {}
  let alignedMovement = false
  for (const audio of movementEvents.filter(event => event.kind === 'audio')) {
    const start = (sourcePointer.monoUs - audio.monoSpanUs[0]) / 1000, end = (destinationPointer.monoUs - audio.monoSpanUs[0]) / 1000
    if (start < 0 || end + 100 >= (audio.endSample - audio.startSample) * 1000 / audio.sampleRate) {
      movementTranscripts[audio.audioSegmentRef] = { unit: 'ms', text: '', granularity: 'segment', words: [], segments: [] }
      continue
    }
    alignedMovement = true
    const words = [{ text: '把这个', startMs: start, endMs: start + 100, granularity: 'word', timing: 'precise', confidence: .99 }, { text: '放到那边', startMs: end, endMs: end + 100, granularity: 'word', timing: 'precise', confidence: .99 }]
    movementTranscripts[audio.audioSegmentRef] = { unit: 'ms', text: '把这个放到那边', granularity: 'word', words, segments: [{ text: '把这个放到那边', startMs: start, endMs: end + 100, granularity: 'segment', timing: 'coarse', words }] }
  }
  assert.ok(alignedMovement, '移动词时必须完整落在真实音频样本内，不能猜测或截断时间戳')
  await app.evaluate((_electron, transcripts) => { globalThis.__t157Transcripts = transcripts }, movementTranscripts)
  await button('转写并审阅').click(); await button('允许本次').click()
  await button('查看「这个」的指向').waitFor({ timeout: 60000 }); await button('查看「这个」的指向').click(); await shot('移动对象与目标位置审阅')
  const movementBefore = structuredClone((await read()).document.layers)
  await button('生成候选').click(); await layout.getByRole('button', { name: '布局方案', exact: true }).waitFor(); assert.equal(await layout.getByRole('button', { name: '布局方案', exact: true }).innerText(), '按讲解移动'); await shot('正式移动候选自动打开')
  await layout.getByRole('button', { name: '应用', exact: true }).click(); await layout.getByText('已应用，可撤销', { exact: true }).waitFor(); await shot('移动候选一步应用')
  assert.notDeepEqual((await read()).document.layers, movementBefore)
  await host().getByRole('button', { name: '随手摆', exact: true }).click(); await host().getByRole('button', { name: /^(撤销|Undo)$/ }).click(); await page.waitForTimeout(1200); await shot('移动候选一步撤销')
  assert.deepEqual((await read()).document.layers, movementBefore)
  assert.ok(await page.evaluate(async () => {
    const ids = [...window.__t157NativeSessions]
    return ids.length >= 2 && (await Promise.all(ids.map(id => window.henjiNative.audioCapture.status(id).then(() => false, () => true)))).every(Boolean)
  }), '原生录音会话必须全部释放')
  evidence.flow = { basis: 'bc23e0733 / 原生录音与通用授权弹窗', changed: '替换失效 WebAudio 夹具、沿正式预检与允许本次流程', assertions: '保留全部图层、历史画面、布局应用与撤销，增加原生会话释放' }
  evidence.recording = { mode: session.mode, pointers: pointers.length, historicalFrames: session.visualEvidenceRefs.length, asrFixtureCalls: await app.evaluate(() => globalThis.__t157Calls), paidCalls: 0 }
  store()
}
module.exports = { installImageExplanationFixture, runImageExplanationScene }
