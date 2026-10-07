const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope } = require('./uiInspectionMcpClient.cjs')
const { observeWorkers, workerSnapshot, waitReleased } = require('./uiInspectionSceneVideoEditLayout.cjs')
const { dialogs, presented } = require('./uiInspectionSceneVideoEditMonitor.cjs')
const { adoptNewVideoEditProject, leaveVideoEditProject, openVideoEditFile, readVideoEditFile, videoEditDockTab } = require('./uiInspectionVideoEditDocuments.cjs')
const button = (page, name) => page.getByRole('button', { name, exact: true })
const group = (page, title) => page.locator('.dv-groupview').filter({ has: page.locator(`[data-dock-tab-title="${title}"]`) })
const ORIGINAL = 'D:/视频制作/0A0片头片尾和素材/2021片头V2 4K 60FPS.mp4'
const PROJECT_ID = 'video-edit-popout'

function fixture() {
  const track = (index, kind, name) => ({ id: `${kind[0]}${index}`, name, index, kind, locked: false, enabled: true, muted: false, solo: false })
  const clip = (id, start) => ({ id, itemId: 'original-item', name: id === 'a' ? '片头A' : '片头B', kind: 'video', track: 1, start, duration: 180, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '' })
  return { format: 'henji-video-project', version: 2, id: PROJECT_ID, name: '独立浮窗验收', revision: 0,
    media: [{ id: 'original', name: '原4K60片头', path: ORIGINAL, kind: 'video', durationSeconds: 7, width: 3840, height: 2160, hasAudio: false, frameRate: { numerator: 60, denominator: 1 }, frameRateMode: 'sampled-constant' }],
    bins: [], items: [{ id: 'original-item', name: '原4K60片头', kind: 'video', mediaId: 'original' }],
    sequences: [{ id: 'main', name: '序列 1', width: 3840, height: 2160, frameRate: { numerator: 60, denominator: 1 }, pixelAspectRatio: { numerator: 1, denominator: 1 }, sampleRate: 48000, channels: 2,
      tracks: [track(0, 'audio', '音频 1'), track(1, 'video', '视频 1'), track(2, 'video', '视频 2')], clips: [clip('a', 0), clip('b', 180)], annotations: [] }] }
}
// 3.1：剪辑是项目里的文档文件，按旧工程形状读出（夹具路径读它对应的实际剪辑）
const readProject = readVideoEditFile
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
      const projectRef = { kind: 'video_edit.document', id: PROJECT_ID }
      let client; let observed = false
      const allWindows = () => app.evaluate(({ BrowserWindow, screen }) => BrowserWindow.getAllWindows().map(window => ({ id: window.id, title: window.getTitle(), bounds: window.getBounds(), display: screen.getDisplayMatching(window.getBounds()).id, primary: screen.getDisplayMatching(window.getBounds()).id === screen.getPrimaryDisplay().id, visible: window.isVisible() })))
      // 主窗口按 Playwright 句柄定位，不按标题：之前的场景可能留下标题同为“痕迹AI”的隐藏窗口
      // （3D 后台渲染窗口的页面标题会覆盖窗口标题）。场景开始前已存在的其他窗口不属于本场景，
      // 一律排除在“窗口数/标题集合”判据之外，判据本身不变。
      let mainWindowId = null; let foreignWindowIds = []
      const windows = async () => (await allWindows()).filter(window => !foreignWindowIds.includes(window.id)).map(window => ({ ...window, main: window.id === mainWindowId }))
      const popOut = async (title) => {
        await group(page, title).locator('.dv-tab').filter({ has: page.locator(`[data-dock-tab-title="${title}"]`) }).click()
        const opened = app.waitForEvent('window', { timeout: 30000 })
        await group(page, title).getByRole('button', { name: '面板菜单', exact: true }).click()
        await button(page, '浮动面板').click()
        const child = await opened; await child.waitForLoadState('domcontentloaded')
        await child.locator(`[data-video-edit-panel]`).first().waitFor({ state: 'visible', timeout: 30000 })
        return child
      }
      const playback = async (frame, playing) => {
        const read = await callTool(client, 'read_application_entity', { ref: projectRef, propertyIds: ['video_edit.document.program_playback'] })
        await callTool(client, 'change_application_entities', operationEnvelope([read], { summary: '节目播放控制', changes: [{ kind: 'set_properties', entityType: 'video_edit.document', target: projectRef, properties: { 'video_edit.document.program_playback': { frame, playing, playbackDirection: 1 } } }] }))
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
        await button(page, '剪辑').first().click(); if (await button(page, '关闭项目').isVisible()) await button(page, '关闭项目').click()
        await page.evaluate(() => localStorage.removeItem('henji.videoEdit.dockLayout.v1'))
        await observeWorkers(page); observed = true
        await dialogs(app, [file], file); await openVideoEditFile(page, file); await presented(page, 0)
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
        assert.equal(await effects.locator('[data-video-edit-effects-clip-name]').first().textContent(), '片头A', '浮窗附着同一工程的当前选区')
        const historyBefore = readProject(file).revision
        await effects.getByLabel('不透明度', { exact: true }).fill('50'); await effects.getByLabel('不透明度', { exact: true }).press('Enter')
        const edited = await saved(page, file, value => value.sequences[0].clips.find(clip => clip.id === 'a').opacity === 0.5, '浮窗修改没有经主窗口工程静默保存')
        assert.equal(edited.sequences[0].clips.length, 2, '在浮窗输入框中打字不得触发剪辑快捷键')
        await button(effects, '重命名片段').click(); await effects.getByLabel('片段名称', { exact: true }).fill('片头A浮窗改名'); await effects.getByLabel('片段名称', { exact: true }).press('Enter')
        await saved(page, file, value => value.sequences[0].clips.find(clip => clip.id === 'a').name === '片头A浮窗改名', '浮窗文字修改没有保存')
        // Keyboard undo from inside the popout runs once, on the same shared history.
        // Enter already left the rename field: Ctrl+Z inside an input is the field's own text undo, as in the main window.
        await effects.locator('[data-video-edit-panel="effects"]').first().focus()
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
        await effects.locator('[data-video-edit-effects-clip-name]').first().waitFor(); assert.equal(await effects.locator('[data-video-edit-effects-clip-name]').first().textContent(), '片头B', '浮窗时间线选区应同步到另一浮窗')
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
        await openVideoEditFile(page, file)
        const expectedTitles = ['痕迹AI', '痕迹AI · 效果控件', '痕迹AI · 时间线', '痕迹AI · 节目画面'].sort()
        for (let attempt = 0; attempt < 200 && JSON.stringify((await windows()).map(window => window.title).sort()) !== JSON.stringify(expectedTitles); attempt++) await page.waitForTimeout(100)
        app.off('window', onWindow)
        evidence.windowsAfterRestore = await windows()
        // 记录的是渲染层看到的窗口矩形（无边框窗口含隐形边框），按同一语义比较恢复后的窗口。
        // 记录版本 2：一个浮窗一条，可装多个面板（4.6），窗口标题取当前标签。
        for (const record of evidence.persistedLayout?.windows ?? []) {
          const title = { effects: '痕迹AI · 效果控件', timeline: '痕迹AI · 时间线', program: '痕迹AI · 节目画面' }[record.active]
          let restored = null
          for (const child of restoredWindows) if (!child.isClosed() && await child.title().catch(() => '') === title) restored = child
          assert.ok(restored, `应恢复 ${title}`)
          let view = null
          for (let attempt = 0; attempt < 30; attempt++) {
            view = await restored.evaluate(() => ({ x: window.screenX, y: window.screenY, width: window.outerWidth, height: window.outerHeight }))
            if (['x', 'y', 'width', 'height'].every(key => Math.abs(view[key] - record.bounds[key]) <= 1)) break
            await page.waitForTimeout(100)
          }
          for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(view[key] - record.bounds[key]) <= 1, `浮窗恢复位置/尺寸不得漂移：${record.active}.${key} ${record.bounds[key]}→${view[key]}`)
        }
        assert.deepEqual(evidence.windowsAfterRestore.map(window => window.title).sort(), ['痕迹AI', '痕迹AI · 效果控件', '痕迹AI · 时间线', '痕迹AI · 节目画面'].sort(), '重开工程后应恢复上次浮出的面板')
        assert.equal(evidence.windowsAfterRestore.find(window => window.title === '痕迹AI · 效果控件').display, displays.primary, '恢复的浮窗应回到上次所在显示器')
        evidence.restoredPages = restoredWindows.length
        evidence.phases.push('主窗口重载无幽灵浮窗；重开工程按本机记录恢复三扇浮窗及其显示器位置')

        phase('dock-back')
        // 自绘标题栏的“贴回主窗口”放回 Dock（PR：关闭窗口则关闭面板，见 video-edit-dock-gestures）。
        for (const child of restoredWindows.filter(value => value !== page && !value.isClosed())) {
          await child.getByRole('button', { name: '贴回主窗口', exact: true }).click().catch(() => {})
        }
        await page.locator('canvas[aria-label="剪辑画面"]').waitFor({ state: 'visible', timeout: 60000 }); await presented(page, 0)
        await group(page, '效果控件').waitFor({ state: 'visible' }); await group(page, '时间线').waitFor({ state: 'visible' })
        for (let attempt = 0; attempt < 100 && (await windows()).length > 1; attempt++) await page.waitForTimeout(100)
        evidence.windowsAfterDock = await windows(); assert.equal(evidence.windowsAfterDock.length, 1, '贴回后不得残留窗口')
        await shot('popout-docked-back')
        evidence.phases.push('标题栏贴回：节目画面回主窗口，无残留窗口')

        await button(page, '关闭项目').click(); await waitReleased(page)
        evidence.resources = await workerSnapshot(page); assert.equal(evidence.resources.live, 0)
        evidence.completed = true; store()
      } catch (error) { evidence.failed = { phase: evidence.currentPhase, message: String(error.message ?? error), stack: error.stack }; store(); await shot('popout-failed').catch(() => {}); throw error }
      finally {
        await client?.close().catch(() => {}); await disableMcp(page).catch(() => {})
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(window => window.getTitle().startsWith('痕迹AI · ')).forEach(window => window.close())).catch(() => {})
        if (await button(page, '关闭项目').isVisible().catch(() => false)) await button(page, '关闭项目').click().catch(() => {})
        if (observed) { await waitReleased(page).catch(error => { evidence.completed = false; evidence.releaseFailure = String(error) }); evidence.resources = await workerSnapshot(page).catch(() => evidence.resources) }
        await page.evaluate(() => { window.__videoLayoutObservers?.forEach(observer => observer.disconnect()); if (window.__videoLayoutNativeWorker) window.Worker = window.__videoLayoutNativeWorker; localStorage.removeItem('henji.videoEdit.dockLayout.v1') }).catch(() => {}); store()
      }
    },
  }
}
/**
 * 剪辑对齐 PR 1.1/1.2：停靠拖放与独立窗口自绘标题栏，必须在真实 Electron 里验收的部分——
 * Ctrl 拖动浮出到松开处、拖到停靠区域外浮出、窗口边缘停靠指示、无边框窗口的标题栏移动与双击最大化、
 * 拖标题栏回主窗口显示停靠指示并停靠、关闭窗口即关闭面板。
 * 跨窗口拖动用浮窗文档内派发的指针事件（带屏幕坐标）驱动：CDP 鼠标坐标相对页面，窗口随拖动移动后会自我叠加。
 */
function createVideoEditDockGesturesScene() {
  return { id: 'video-edit-dock-gestures', surface: '剪辑', name: '剪辑-PR式停靠拖放与独立窗口标题栏', writesUserData: true,
    setup: async (page, app, { capture }) => {
      const root = path.resolve('node_modules/.cache/video-edit-dock-gestures'); fs.rmSync(root, { recursive: true, force: true }); fs.mkdirSync(root, { recursive: true })
      const file = path.join(root, 'gestures.henji-video'); fs.writeFileSync(file, JSON.stringify({ ...fixture(), id: 'video-edit-dock-gestures', name: '停靠拖放验收' }))
      const evidence = { completed: false, phases: [], captures: [] }
      const store = () => fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
      const phase = name => { evidence.currentPhase = name; store() }
      const shot = async name => { evidence.captures.push({ name, result: await capture(name) }); store() }
      const tab = title => group(page, title).locator('.dv-tab').filter({ has: page.locator(`[data-dock-tab-title="${title}"]`) })
      const center = box => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 })
      const popoutWindows = () => app.evaluate(({ BrowserWindow, screen }) => BrowserWindow.getAllWindows().filter(window => window.getTitle().startsWith('痕迹AI · ')).map(window => ({ id: window.id, title: window.getTitle(), bounds: window.getBounds(), maximized: window.isMaximized(), workArea: screen.getDisplayMatching(window.getBounds()).workArea })))
      const popoutBounds = async title => (await popoutWindows()).find(window => window.title === title)?.bounds
      const dockRoot = () => page.evaluate(() => { const rect = document.querySelector('.henji-videoEdit-dock').parentElement.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height } })
      /** 主窗口客户区点 → 屏幕坐标（DIP）。 */
      const toScreen = async point => {
        const handle = await app.browserWindow(page); const bounds = await handle.evaluate(window => window.getBounds()); await handle.dispose()
        const zoom = await page.evaluate(() => (Number(document.documentElement.dataset.uiScale) || 100) / 100)
        return { x: Math.round(bounds.x + point.x * zoom), y: Math.round(bounds.y + point.y * zoom) }
      }
      /** 在浮窗标题栏上派发带屏幕坐标的指针事件（按下 → 逐步移动；`release` 为 true 时松开）。 */
      const titleDrag = (child, steps, release) => child.evaluate(({ steps, release }) => {
        const bar = document.querySelector('[data-window-titlebar="panel"]')
        const rect = bar.getBoundingClientRect(); const local = { x: rect.left + rect.width * 0.6, y: rect.top + rect.height / 2 }
        const fire = (type, point) => bar.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: local.x, clientY: local.y, screenX: point.x, screenY: point.y, ctrlKey: Boolean(steps.ctrl) }))
        if (steps.start) fire('pointerdown', steps.start)
        for (const point of steps.moves ?? []) fire('pointermove', point)
        if (release) fire('pointerup', steps.moves?.at(-1) ?? steps.start)
      }, { steps, release })
      const lerp = (from, to, count) => Array.from({ length: count }, (_, index) => ({ x: Math.round(from.x + (to.x - from.x) * (index + 1) / count), y: Math.round(from.y + (to.y - from.y) * (index + 1) / count) }))
      try {
        phase('open-project')
        await button(page, '剪辑').first().click(); if (await button(page, '关闭项目').isVisible()) await button(page, '关闭项目').click()
        await page.evaluate(() => { localStorage.removeItem('henji.videoEdit.dockLayout.v1'); localStorage.removeItem('henji.videoEdit.popoutLayout.v1') })
        await dialogs(app, [file], file); await openVideoEditFile(page, file); await presented(page, 0)

        phase('ctrl-drag-float')
        // Ctrl+拖动标签：拖动中不显示停靠指示、指针处显示浮动窗口预览；松开浮出为独立窗口，标题栏抓取点落在松开处。
        const effectsTab = center(await tab('效果控件').boundingBox())
        const release = center(await group(page, '节目画面').boundingBox())
        await page.mouse.move(effectsTab.x, effectsTab.y); await page.keyboard.down('Control'); await page.mouse.down()
        await page.mouse.move(release.x, release.y, { steps: 16 })
        evidence.ctrlPreviewVisible = await page.locator('[data-dock-float-preview]:not(.hidden)').isVisible()
        evidence.ctrlDockOverlayVisible = await page.locator('.dv-drop-target-anchor, .dv-drop-target-selection').evaluateAll(nodes => nodes.some(node => getComputedStyle(node).visibility !== 'hidden' && node.getBoundingClientRect().width > 0))
        await shot('dock-ctrl-drag-preview')
        const floated = app.waitForEvent('window', { timeout: 30000 })
        await page.mouse.up(); await page.keyboard.up('Control')
        const effects = await floated; await effects.waitForLoadState('domcontentloaded')
        await effects.locator('[data-video-edit-panel="effects"]').waitFor({ state: 'visible', timeout: 30000 })
        assert.equal(evidence.ctrlPreviewVisible, true, 'Ctrl 拖动时应显示浮动窗口预览')
        assert.equal(evidence.ctrlDockOverlayVisible, false, 'Ctrl 拖动时不应显示停靠指示')
        const releaseScreen = await toScreen(release)
        evidence.ctrlFloat = { releaseScreen, bounds: await popoutBounds('痕迹AI · 效果控件') }
        assert.ok(evidence.ctrlFloat.bounds, '应浮出效果控件独立窗口')
        assert.ok(Math.abs(evidence.ctrlFloat.bounds.x - (releaseScreen.x - 48)) <= 12 && Math.abs(evidence.ctrlFloat.bounds.y - (releaseScreen.y - 16)) <= 12, `浮出窗口应放在松开处：${JSON.stringify(evidence.ctrlFloat)}`)
        assert.equal(await videoEditDockTab(page, '效果控件').count(), 0, '浮出后主窗口不再有效果控件')
        assert.equal(await effects.locator('[data-window-titlebar="panel"]').count(), 1, '独立窗口使用自绘标题栏')
        await effects.screenshot({ path: path.join(root, 'child-titlebar.png') })
        evidence.phases.push('Ctrl 拖动：无停靠指示、有浮动预览，松开在松开处浮出独立窗口（自绘标题栏）')

        phase('titlebar-maximize')
        const bar = await effects.locator('[data-window-titlebar="panel"]').boundingBox()
        await effects.mouse.dblclick(bar.x + bar.width * 0.6, bar.y + bar.height / 2)
        await page.waitForTimeout(400)
        const maximized = (await popoutWindows()).find(window => window.title === '痕迹AI · 效果控件')
        evidence.maximized = maximized
        // 系统最大化：无边框窗口的外框会超出可用区域一圈隐形边框，以最大化状态为准。
        assert.equal(maximized.maximized, true, `双击标题栏应最大化：${JSON.stringify(maximized)}`)
        await effects.screenshot({ path: path.join(root, 'child-maximized.png') })
        const maxBar = await effects.locator('[data-window-titlebar="panel"]').boundingBox()
        await effects.mouse.dblclick(maxBar.x + maxBar.width * 0.6, maxBar.y + maxBar.height / 2)
        await page.waitForTimeout(400)
        evidence.restored = await popoutBounds('痕迹AI · 效果控件')
        evidence.restoredRendererView = await effects.evaluate(() => ({ x: window.screenX, y: window.screenY, width: window.outerWidth, height: window.outerHeight }))
        // 尺寸与横向位置还原；纵向位置可能被系统夹回屏幕内（浮出时窗口下沿超出了屏幕）。
        const original = evidence.ctrlFloat.bounds; const area = maximized.workArea
        assert.ok(['x', 'width', 'height'].every(key => Math.abs(evidence.restored[key] - original[key]) <= 2)
          && (Math.abs(evidence.restored.y - original.y) <= 2 || (evidence.restored.y < original.y && evidence.restored.y + evidence.restored.height <= area.y + area.height + 2)), `再次双击应还原：${JSON.stringify({ original, restored: evidence.restored })}`)
        evidence.phases.push('双击标题栏最大化（铺满可用区域）与还原')

        phase('titlebar-move')
        const before = await popoutBounds('痕迹AI · 效果控件')
        const displayLeft = (await popoutWindows())[0].workArea.x
        const start = { x: before.x + 200, y: before.y + 16 }
        // 拖过显示器左边界到另一块屏幕（渲染层 moveTo 做不到，由主进程代管）；
        // 浮窗与主窗口重叠：按住 Ctrl 拖动只移动、不停靠（PR）。
        const delta = { x: displayLeft - before.x - 300, y: -70 }
        await titleDrag(effects, { start, moves: lerp(start, { x: start.x + delta.x, y: start.y + delta.y }, 10), ctrl: true }, true)
        await page.waitForTimeout(300)
        evidence.moved = { before, delta, after: await popoutBounds('痕迹AI · 效果控件') }
        assert.ok(Math.abs(evidence.moved.after.x - before.x - delta.x) <= 2 && Math.abs(evidence.moved.after.y - before.y - delta.y) <= 2, `拖动标题栏应移动窗口（可跨显示器）：${JSON.stringify(evidence.moved)}`)
        evidence.phases.push('拖动自绘标题栏移动无边框窗口并跨到另一块显示器（Ctrl：在主窗口上方也不停靠）')

        phase('drag-back-dock')
        // 拖标题栏回主窗口：在主窗口显示停靠指示、窗口收成标题条；松开停靠到节目画面所在组（编组）。
        const moved = evidence.moved.after
        const grab = { x: moved.x + 200, y: moved.y + 16 }
        const target = await toScreen(center(await group(page, '节目画面').boundingBox()))
        await titleDrag(effects, { start: grab, moves: lerp(grab, target, 12) }, false)
        await page.waitForTimeout(300)
        evidence.dragBack = { indicator: await page.locator('[data-dock-drop-zone]:not(.hidden)').evaluateAll(nodes => nodes.map(node => ({ zone: node.dataset.dockDropZone, rect: node.getBoundingClientRect().toJSON() }))), window: await popoutBounds('痕迹AI · 效果控件') }
        await shot('dock-drag-back-indicator')
        assert.equal(evidence.dragBack.indicator.length, 1, '拖回主窗口时应显示停靠指示')
        assert.equal(evidence.dragBack.indicator[0].zone, 'group', '节目画面中部是编组区')
        assert.ok(evidence.dragBack.window.height <= 120, `拖向落点时窗口应收成标题条：${JSON.stringify(evidence.dragBack.window)}`)
        await titleDrag(effects, { moves: [target] }, true)
        for (let attempt = 0; attempt < 50 && (await popoutWindows()).length; attempt++) await page.waitForTimeout(100)
        assert.equal((await popoutWindows()).length, 0, '停靠后独立窗口关闭')
        await videoEditDockTab(group(page, '节目画面'), '效果控件').waitFor({ state: 'attached', timeout: 10000 })
        assert.equal(await page.locator('[data-dock-drop-zone]:not(.hidden)').count(), 0, '停靠后指示消失')
        evidence.phases.push('拖标题栏回主窗口：主窗口显示停靠指示、窗口收成标题条，松开叠进目标组')

        phase('root-edge')
        // 贴近整个停靠区域右边缘：窗口边缘停靠（窄带指示），松开后素材组贴到最右侧。
        const dock = await dockRoot()
        const projectTab = center(await tab('素材').boundingBox())
        const edge = { x: dock.x + dock.width - 6, y: dock.y + dock.height / 2 }
        await page.mouse.move(projectTab.x, projectTab.y); await page.mouse.down()
        await page.mouse.move(edge.x, edge.y, { steps: 16 })
        evidence.rootEdge = { indicator: await page.locator('[data-dock-drop-zone]:not(.hidden)').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().toJSON())) }
        await shot('dock-root-edge-indicator')
        await page.mouse.up(); await page.waitForTimeout(300)
        const projectBox = await group(page, '素材').boundingBox()
        evidence.rootEdge.project = projectBox; evidence.rootEdge.dock = dock
        assert.equal(evidence.rootEdge.indicator.length, 1, '贴近窗口边缘应显示停靠指示')
        assert.ok(evidence.rootEdge.indicator[0].width <= dock.width * 0.1 + 1, '窗口边缘停靠指示是窄带')
        assert.ok(Math.abs(projectBox.x + projectBox.width - (dock.x + dock.width)) <= 2 && projectBox.height >= dock.height - 4, `素材组应贴到整个区域右侧：${JSON.stringify(evidence.rootEdge)}`)
        evidence.phases.push('窗口边缘停靠：窄带指示，松开贴到整个区域右侧')

        phase('drop-outside-float')
        // 不按修饰键拖到停靠区域外（命令带）松开：浮出为独立窗口；关闭窗口即关闭面板。
        const timelineTab = center(await tab('时间线').boundingBox())
        const outside = { x: dock.x + dock.width / 2, y: dock.y - 12 }
        await page.mouse.move(timelineTab.x, timelineTab.y); await page.mouse.down()
        await page.mouse.move(outside.x, outside.y, { steps: 16 })
        evidence.outsidePreviewVisible = await page.locator('[data-dock-float-preview]:not(.hidden)').isVisible()
        await shot('dock-outside-float-preview')
        const floatedTimeline = app.waitForEvent('window', { timeout: 30000 })
        await page.mouse.up()
        const timeline = await floatedTimeline; await timeline.waitForLoadState('domcontentloaded')
        await timeline.locator('[data-video-edit-panel="timeline"]').waitFor({ state: 'visible', timeout: 30000 })
        assert.equal(evidence.outsidePreviewVisible, true, '拖到空白处应显示浮动窗口预览')
        await timeline.locator('[data-window-titlebar="panel"]').getByRole('button', { name: '关闭时间线', exact: true }).click()
        for (let attempt = 0; attempt < 50 && (await popoutWindows()).length; attempt++) await page.waitForTimeout(100)
        assert.equal((await popoutWindows()).length, 0, '关闭按钮关闭独立窗口')
        assert.equal(await videoEditDockTab(page, '时间线').count(), 0, '关闭独立窗口即关闭其中的面板')
        evidence.phases.push('拖到停靠区域外松开浮出；关闭独立窗口即关闭面板')

        await page.getByRole('button', { name: '面板', exact: true }).click(); await button(page, '重置布局').click()
        await button(page, '关闭项目').click()
        evidence.completed = true; store()
      } catch (error) { evidence.failed = { phase: evidence.currentPhase, message: String(error.message ?? error), stack: error.stack }; store(); await shot('dock-gestures-failed').catch(() => {}); throw error }
      finally {
        await page.mouse.up().catch(() => {}); await page.keyboard.up('Control').catch(() => {})
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(window => window.getTitle().startsWith('痕迹AI · ')).forEach(window => window.close())).catch(() => {})
        if (await button(page, '关闭项目').isVisible().catch(() => false)) await button(page, '关闭项目').click().catch(() => {})
        await page.evaluate(() => { localStorage.removeItem('henji.videoEdit.dockLayout.v1'); localStorage.removeItem('henji.videoEdit.popoutLayout.v1') }).catch(() => {}); store()
      }
    },
  }
}
module.exports = { createVideoEditPopoutScene, createVideoEditDockGesturesScene }
