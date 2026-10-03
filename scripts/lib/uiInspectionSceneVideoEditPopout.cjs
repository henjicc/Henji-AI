const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope } = require('./uiInspectionMcpClient.cjs')
const { observeWorkers, workerSnapshot, waitReleased } = require('./uiInspectionSceneVideoEditLayout.cjs')
const { dialogs, presented } = require('./uiInspectionSceneVideoEditMonitor.cjs')
const button = (page, name) => page.getByRole('button', { name, exact: true })
const group = (page, title) => page.locator('.dv-groupview').filter({ has: button(page, `关闭${title}`) })
const ORIGINAL = 'D:/视频制作/0A0片头片尾和素材/2021片头V2 4K 60FPS.mp4'
const PROJECT_ID = 'video-edit-popout'

function fixture() {
  const track = (index, kind, name) => ({ id: `${kind[0]}${index}`, name, index, kind, locked: false, enabled: true, muted: false, solo: false })
  const clip = (id, start) => ({ id, itemId: 'original-item', name: id === 'a' ? '片头A' : '片头B', kind: 'video', track: 1, start, duration: 180, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, brightness: 1, text: '' })
  return { format: 'henji-video-project', version: 2, id: PROJECT_ID, name: '独立浮窗验收', revision: 0,
    media: [{ id: 'original', name: '原4K60片头', path: ORIGINAL, kind: 'video', durationSeconds: 7, width: 3840, height: 2160, hasAudio: false, frameRate: { numerator: 60, denominator: 1 }, frameRateMode: 'sampled-constant' }],
    bins: [], items: [{ id: 'original-item', name: '原4K60片头', kind: 'video', mediaId: 'original' }],
    sequences: [{ id: 'main', name: '序列 1', width: 3840, height: 2160, frameRate: { numerator: 60, denominator: 1 }, pixelAspectRatio: { numerator: 1, denominator: 1 }, sampleRate: 48000, channels: 2,
      tracks: [track(0, 'audio', '音频 1'), track(1, 'video', '视频 1'), track(2, 'video', '视频 2')], clips: [clip('a', 0), clip('b', 180)], annotations: [] }] }
}
const readProject = file => JSON.parse(fs.readFileSync(file, 'utf8'))
async function saved(page, file, predicate, message) {
  for (let attempt = 0; attempt < 300; attempt++) { const value = readProject(file); if (predicate(value)) return value; await page.waitForTimeout(100) }
  throw new Error(message)
}
/** Real frame updates of the presented Program canvas in whichever window owns it (not rAF ticks). */
async function measureUpdates(target, seconds) {
  return target.evaluate(async duration => {
    const canvas = document.querySelector('canvas[aria-label="剪辑画面"]')
    const frames = []; const observer = new MutationObserver(() => frames.push({ at: performance.now(), frame: Number(canvas.dataset.presentedFrame) }))
    observer.observe(canvas, { attributes: true, attributeFilter: ['data-presented-frame'] })
    await new Promise(resolve => setTimeout(resolve, duration * 1000)); observer.disconnect()
    const distinct = frames.filter((value, index) => index === 0 || value.frame !== frames[index - 1].frame)
    const gaps = distinct.slice(1).map((value, index) => value.at - distinct[index].at).sort((a, b) => a - b)
    const span = distinct.length > 1 ? (distinct.at(-1).at - distinct[0].at) / 1000 : 0
    return { updates: distinct.length, perSecond: span ? (distinct.length - 1) / span : 0, p95GapMs: gaps.length ? gaps[Math.floor(gaps.length * 0.95)] : null, maxGapMs: gaps.at(-1) ?? null }
  }, seconds)
}

function createVideoEditPopoutScene() {
  return { id: 'video-edit-popout', surface: '剪辑', name: '剪辑-独立浮窗跨窗口编辑撤销保存与节目显示面迁移', writesUserData: true,
    setup: async (page, app, { capture }) => {
      const root = path.resolve('node_modules/.cache/video-edit-popout'); fs.rmSync(root, { recursive: true, force: true }); fs.mkdirSync(root, { recursive: true })
      const file = path.join(root, 'popout.henji-video'); fs.writeFileSync(file, JSON.stringify(fixture()))
      const evidence = { completed: false, phases: [], captures: [] }
      const store = () => fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
      const phase = name => { evidence.currentPhase = name; store() }
      const shot = async name => { evidence.captures.push({ name, result: await capture(name) }); store() }
      const projectRef = { kind: 'video_edit.project', id: PROJECT_ID }
      let client; let observed = false
      const allWindows = () => app.evaluate(({ BrowserWindow, screen }) => BrowserWindow.getAllWindows().map(window => ({ id: window.id, title: window.getTitle(), bounds: window.getBounds(), display: screen.getDisplayMatching(window.getBounds()).id, primary: screen.getDisplayMatching(window.getBounds()).id === screen.getPrimaryDisplay().id, visible: window.isVisible() })))
      // 主窗口按 Playwright 句柄定位，不按标题：之前的场景可能留下标题同为“痕迹AI”的隐藏窗口
      // （3D 后台渲染窗口的页面标题会覆盖窗口标题）。场景开始前已存在的其他窗口不属于本场景，
      // 一律排除在“窗口数/标题集合”判据之外，判据本身不变。
      let mainWindowId = null; let foreignWindowIds = []
      const windows = async () => (await allWindows()).filter(window => !foreignWindowIds.includes(window.id)).map(window => ({ ...window, main: window.id === mainWindowId }))
      const popOut = async (title) => {
        await group(page, title).locator('.dv-tab').filter({ has: button(page, `关闭${title}`) }).click()
        const opened = app.waitForEvent('window', { timeout: 30000 })
        await group(page, title).getByRole('button', { name: '面板菜单', exact: true }).click()
        await page.getByText('在独立窗口打开', { exact: true }).click()
        const child = await opened; await child.waitForLoadState('domcontentloaded')
        await child.locator(`[data-video-edit-panel]`).first().waitFor({ state: 'visible', timeout: 30000 })
        return child
      }
      const playback = async (frame, playing) => {
        const read = await callTool(client, 'read_application_entity', { ref: projectRef, propertyIds: ['video_edit.project.program_playback'] })
        await callTool(client, 'change_application_entities', operationEnvelope([read], { summary: '节目播放控制', changes: [{ kind: 'set_properties', entityType: 'video_edit.project', target: projectRef, properties: { 'video_edit.project.program_playback': { frame, playing, playbackDirection: 1 } } }] }))
      }
      try {
        const displays = await app.evaluate(({ screen }) => ({ all: screen.getAllDisplays().map(display => ({ id: display.id, bounds: display.bounds, scaleFactor: display.scaleFactor })), primary: screen.getPrimaryDisplay().id }))
        const mainHandle = await app.browserWindow(page); mainWindowId = await mainHandle.evaluate(window => window.id); await mainHandle.dispose()
        const startWindows = await allWindows(); foreignWindowIds = startWindows.filter(window => window.id !== mainWindowId).map(window => window.id)
        evidence.foreignWindowsAtStart = startWindows.filter(window => foreignWindowIds.includes(window.id))
        evidence.displays = displays; evidence.windowsAtStart = await windows()
        const main = evidence.windowsAtStart.find(window => window.main); assert.ok(main, '主窗口必须能按句柄定位')
        assert.equal(main.title, '痕迹AI', '主窗口标题与浮窗标题可区分')
        if (process.env.HENJI_DEV_DISPLAY_POINT) assert.equal(main.primary, false, '主窗口应在指定副屏1')

        phase('open-project')
        await button(page, '剪辑').first().click(); if (await button(page, '关闭工程').isVisible()) await button(page, '关闭工程').click()
        await page.evaluate(() => localStorage.removeItem('henji.videoEdit.dockLayout.v1'))
        await observeWorkers(page); observed = true
        await dialogs(app, [file], file); await button(page, '打开工程').click(); await presented(page, 0)
        const identity = await authorizeMcpConnection(page, { name: '独立浮窗验收', allowWrites: true }); client = await connectMcpClient(identity.config, 'Henji popout Reality')
        await playback(0, false); await presented(page, 0)

        phase('effects-popout')
        await page.locator('[data-video-edit-clip="a"]').click()
        const effects = await popOut('效果控件')
        evidence.windowsWithEffects = await windows()
        const effectsWindow = evidence.windowsWithEffects.find(window => window.title === '痕迹AI · 效果控件')
        assert.ok(effectsWindow, `浮窗标题应可区分：${JSON.stringify(evidence.windowsWithEffects)}`)
        assert.equal(evidence.windowsWithEffects.filter(window => window.title === '痕迹AI').length, 1)
        // Move the popout to the other display (Windows #2 primary) — the main window stays on #1.
        const primary = displays.all.find(display => display.id === displays.primary)
        await app.evaluate(({ BrowserWindow }, { id, bounds }) => BrowserWindow.fromId(id).setBounds(bounds), { id: effectsWindow.id, bounds: { x: primary.bounds.x + 120, y: primary.bounds.y + 120, width: 520, height: 720 } })
        evidence.effectsMoved = (await windows()).find(window => window.id === effectsWindow.id)
        assert.equal(evidence.effectsMoved.display, displays.primary, '浮窗应能移动到另一显示器')
        assert.equal(await effects.getByLabel('片段名称').inputValue(), '片头A', '浮窗附着同一工程的当前选区')
        const historyBefore = readProject(file).revision
        await effects.getByLabel('不透明度').fill('0.5')
        const edited = await saved(page, file, value => value.sequences[0].clips.find(clip => clip.id === 'a').opacity === 0.5, '浮窗修改没有经主窗口工程静默保存')
        assert.equal(edited.sequences[0].clips.length, 2, '在浮窗输入框中打字不得触发剪辑快捷键')
        await effects.getByLabel('片段名称').fill('片头A浮窗改名')
        await saved(page, file, value => value.sequences[0].clips.find(clip => clip.id === 'a').name === '片头A浮窗改名', '浮窗文字修改没有保存')
        // Keyboard undo from inside the popout runs once, on the same shared history.
        // Leave the text field first: Ctrl+Z inside an input is the field's own text undo, as in the main window.
        await effects.getByLabel('片段名称').blur(); await effects.locator('[data-video-edit-panel="effects"]').first().focus()
        evidence.focusBeforeUndo = await effects.evaluate(() => ({ tag: document.activeElement?.tagName, panel: document.activeElement?.closest('[data-video-edit-panel]')?.getAttribute('data-video-edit-panel') ?? null }))
        await effects.keyboard.press('Control+z')
        const undone = await saved(page, file, value => value.sequences[0].clips.find(clip => clip.id === 'a').name === '片头A', '浮窗内撤销没有生效')
        assert.equal(undone.sequences[0].clips.find(clip => clip.id === 'a').opacity, 0.5, '一次撤销只能撤回最后一步')
        await button(page, '撤销').click()
        await saved(page, file, value => value.sequences[0].clips.find(clip => clip.id === 'a').opacity === 1, '主窗口撤销应撤回浮窗中的修改')
        evidence.effectsEdit = { revisionBefore: historyBefore }
        await effects.screenshot({ path: path.join(root, 'child-effects.png') })
        evidence.phases.push('效果控件浮窗移到主屏2：同一选区编辑、输入不触发快捷键、浮窗与主窗共用一次一步撤销并静默保存'); await shot('popout-effects-on-other-display')

        phase('timeline-popout')
        const timeline = await popOut('时间线')
        await timeline.locator('[data-video-edit-clip="b"]').click()
        await effects.getByLabel('片段名称').waitFor(); assert.equal(await effects.getByLabel('片段名称').inputValue(), '片头B', '浮窗时间线选区应同步到另一浮窗')
        const handle = timeline.locator('[data-video-edit-clip="b"]'); const box = await handle.boundingBox()
        await timeline.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await timeline.mouse.down()
        await timeline.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 6 }); await timeline.mouse.up()
        const dragged = await saved(page, file, value => value.sequences[0].clips.find(clip => clip.id === 'b').start > 180, '浮窗时间线拖动没有移动片段')
        evidence.timelineDrag = { start: dragged.sequences[0].clips.find(clip => clip.id === 'b').start }
        await timeline.locator('[data-video-edit-panel="timeline"]').first().focus()
        await timeline.keyboard.press('Control+z')
        await saved(page, file, value => value.sequences[0].clips.find(clip => clip.id === 'b').start === 180, '浮窗时间线撤销没有生效')
        await timeline.screenshot({ path: path.join(root, 'child-timeline.png') })
        evidence.phases.push('时间线浮窗：点选同步、真实拖动移动片段、浮窗内快捷键撤销一次')

        phase('program-popout')
        await playback(0, true); await page.waitForTimeout(400)
        evidence.dockedPlayback = await measureUpdates(page, 3); await playback(0, false)
        const program = await popOut('节目画面')
        await program.locator('canvas[aria-label="剪辑画面"]').waitFor({ state: 'visible', timeout: 60000 })
        await program.waitForFunction(() => document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame === '0', null, { timeout: 90000 })
        assert.equal(await page.locator('canvas[aria-label="剪辑画面"]').count(), 0, '节目显示面只能存在于一个窗口')
        const workers = await workerSnapshot(page); evidence.programWorkers = { live: workers.live, peak: workers.peakLive }
        await playback(0, true); await program.waitForTimeout(400)
        evidence.popoutPlayback = await measureUpdates(program, 3); await playback(0, false)
        assert.ok(evidence.popoutPlayback.perSecond >= 55, `浮窗节目实际更新应保持4K60：${JSON.stringify(evidence.popoutPlayback)}`)
        await playback(240, false)
        await program.waitForFunction(() => document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame === '240', null, { timeout: 30000 })
        await shot('popout-program-playing'); await program.screenshot({ path: path.join(root, 'child-program.png') })
        evidence.phases.push('节目画面浮窗：旧会话退场后接入新显示面，单窗口唯一画面，4K60实际更新率对比')

        phase('reload-restore')
        // Main reload must not leave ghost popouts; the per-machine layout restores them after the project reopens.
        evidence.persistedLayout = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('henji.videoEdit.popoutLayout.v1') ?? 'null') } catch { return 'unreadable' } })
        await page.reload({ waitUntil: 'domcontentloaded' })
        for (let attempt = 0; attempt < 100 && (await windows()).length > 1; attempt++) await page.waitForTimeout(100)
        evidence.windowsAfterReload = await windows(); assert.equal(evidence.windowsAfterReload.length, 1, '主窗口重载后不得残留幽灵浮窗')
        await observeWorkers(page)
        await button(page, '剪辑').first().click(); await dialogs(app, [file], file)
        const restoredWindows = []; const onWindow = child => restoredWindows.push(child); app.on('window', onWindow)
        await button(page, '打开工程').click()
        const expectedTitles = ['痕迹AI', '痕迹AI · 效果控件', '痕迹AI · 时间线', '痕迹AI · 节目画面'].sort()
        for (let attempt = 0; attempt < 200 && JSON.stringify((await windows()).map(window => window.title).sort()) !== JSON.stringify(expectedTitles); attempt++) await page.waitForTimeout(100)
        app.off('window', onWindow)
        evidence.windowsAfterRestore = await windows()
        for (const record of evidence.persistedLayout?.panels ?? []) {
          const title = { effects: '痕迹AI · 效果控件', timeline: '痕迹AI · 时间线', program: '痕迹AI · 节目画面' }[record.id]
          const restored = evidence.windowsAfterRestore.find(window => window.title === title)
          for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(restored.bounds[key] - record.bounds[key]) <= 1, `浮窗恢复位置/尺寸不得漂移：${record.id}.${key} ${record.bounds[key]}→${restored.bounds[key]}`)
        }
        assert.deepEqual(evidence.windowsAfterRestore.map(window => window.title).sort(), ['痕迹AI', '痕迹AI · 效果控件', '痕迹AI · 时间线', '痕迹AI · 节目画面'].sort(), '重开工程后应恢复上次浮出的面板')
        assert.equal(evidence.windowsAfterRestore.find(window => window.title === '痕迹AI · 效果控件').display, displays.primary, '恢复的浮窗应回到上次所在显示器')
        const restoredProgram = restoredWindows.find(child => child.url() === 'about:blank' && child !== page)
        evidence.restoredPages = restoredWindows.length
        evidence.phases.push('主窗口重载无幽灵浮窗；重开工程按本机记录恢复三扇浮窗及其显示器位置')
        void restoredProgram

        phase('dock-back')
        for (const title of ['痕迹AI · 节目画面', '痕迹AI · 时间线', '痕迹AI · 效果控件']) {
          await app.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows().find(window => window.getTitle() === value)?.close(), title)
        }
        await page.locator('canvas[aria-label="剪辑画面"]').waitFor({ state: 'visible', timeout: 60000 }); await presented(page, 0)
        await group(page, '效果控件').waitFor({ state: 'visible' }); await group(page, '时间线').waitFor({ state: 'visible' })
        evidence.windowsAfterDock = await windows(); assert.equal(evidence.windowsAfterDock.length, 1, '关闭浮窗后不得残留窗口')
        await shot('popout-docked-back')
        evidence.phases.push('关闭浮窗即贴回，节目画面回主窗口，无残留窗口')

        await button(page, '关闭工程').click(); await waitReleased(page)
        evidence.resources = await workerSnapshot(page); assert.equal(evidence.resources.live, 0)
        evidence.completed = true; store()
      } catch (error) { evidence.failed = { phase: evidence.currentPhase, message: String(error.message ?? error), stack: error.stack }; store(); await shot('popout-failed').catch(() => {}); throw error }
      finally {
        await client?.close().catch(() => {}); await disableMcp(page).catch(() => {})
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(window => window.getTitle().startsWith('痕迹AI · ')).forEach(window => window.close())).catch(() => {})
        if (await button(page, '关闭工程').isVisible().catch(() => false)) await button(page, '关闭工程').click().catch(() => {})
        if (observed) { await waitReleased(page).catch(error => { evidence.completed = false; evidence.releaseFailure = String(error) }); evidence.resources = await workerSnapshot(page).catch(() => evidence.resources) }
        await page.evaluate(() => { window.__videoLayoutObservers?.forEach(observer => observer.disconnect()); if (window.__videoLayoutNativeWorker) window.Worker = window.__videoLayoutNativeWorker; localStorage.removeItem('henji.videoEdit.dockLayout.v1') }).catch(() => {}); store()
      }
    },
  }
}
module.exports = { createVideoEditPopoutScene }
