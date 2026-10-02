const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp } = require('./uiInspectionMcpClient.cjs')
const { dialogs, presented } = require('./uiInspectionSceneVideoEditMonitor.cjs')

/**
 * 剪辑片段链接（2.5，参照 Premiere Pro）在真实 Electron 时间线中的鼠标与键盘交互：
 * - 链接选择开启时点击任一部分选中整组（画面 + 两条同源声音）；
 * - 按住 Alt 点击只选一条并单独拖动，同源失步时片段上显示偏移帧数，右键“移入同步”恢复；
 * - 工具栏“链接选择”关闭后点击只选一条，开关状态经 MCP 时间线视图同源读回；
 * - 剃刀在同一帧拆开整组且右半各自成链，Alt 剃刀只拆一条并保留链接；
 * - 右键“解除链接”后各片段完全独立。全程不改原素材文件。
 */
const ROOT = path.resolve('node_modules/.cache/video-edit-links')
const FPS = 30
const button = (page, name) => page.getByRole('button', { name, exact: true })
const clipNode = (page, id) => page.locator(`[data-video-edit-clip="${id}"]`)
const label = (page, id, name) => clipNode(page, id).getByRole('button', { name: `选择片段 ${name}`, exact: true })
const readProject = file => JSON.parse(fs.readFileSync(file, 'utf8'))
async function saved(page, file, matches, message) {
  for (let attempt = 0; attempt < 160; attempt++) {
    const value = readProject(file)
    if (matches(value)) return value
    await page.waitForTimeout(50)
  }
  assert.fail(message)
}
/**
 * Place the clip row in the middle of the band the timeline does not edge-scroll (below the 28px sticky
 * ruler and outside the 32px auto-scroll edges), so a short 960x640 panel does not scroll the drag onto
 * another track; then prove the pointer really lands on the clip.
 */
async function pointOn(page, id, offsetX) {
  const node = clipNode(page, id)
  const band = await node.evaluate(element => {
    const host = element.closest('[data-video-edit-timeline-viewport]'); const rect = host.getBoundingClientRect(); const box = element.getBoundingClientRect()
    const top = rect.top + 28 + 32; const bottom = rect.bottom - 32
    host.scrollTop += box.top + box.height / 2 - (top + bottom) / 2
    return { top, bottom }
  })
  assert.ok(band.bottom > band.top, '时间线面板过矮，没有不触发边缘滚动的拖动区域')
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const box = await node.boundingBox()
  const point = { x: box.x + (offsetX ?? box.width / 2), y: box.y + box.height / 2 }
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-video-edit-clip]')?.getAttribute('data-video-edit-clip') ?? null, point)
  assert.equal(hit, id, `指针位置未落在片段 ${id} 上`)
  return point
}
const badges = page => page.locator('[data-video-edit-sync-offset]').evaluateAll(nodes => Object.fromEntries(nodes.map(node => [node.closest('[data-video-edit-clip]').getAttribute('data-video-edit-clip'), node.textContent])))

function fixture() {
  fs.mkdirSync(ROOT, { recursive: true })
  const source = path.join(ROOT, 'links-av.mp4')
  if (!fs.existsSync(source)) {
    const { ffmpegPath } = require('./mediaBinaries.cjs')
    execFileSync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=1280x720:rate=${FPS}`, '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '6', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', source], { windowsHide: true })
  }
  const base = { start: 0, duration: 120, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, brightness: 1, text: '', itemId: 'links-item', linkId: 'links-take' }
  const project = {
    format: 'henji-video-project', version: 2, id: 'reality-video-links', name: '链接剪辑验收', revision: 0,
    media: [{ id: 'links-media', name: '同期音画', path: source, kind: 'video', width: 1280, height: 720, durationSeconds: 6, hasAudio: true, frameRate: { numerator: FPS, denominator: 1 } }],
    bins: [], items: [{ id: 'links-item', name: '同期音画', kind: 'video', mediaId: 'links-media' }],
    sequences: [{ id: 'links-sequence', name: '序列 1', width: 1280, height: 720, frameRate: { numerator: FPS, denominator: 1 }, pixelAspectRatio: { numerator: 1, denominator: 1 }, sampleRate: 48000, channels: 2,
      tracks: [...Array.from({ length: 8 }, (_, index) => ({ id: `links-track-${index}`, name: index ? `视频 ${index}` : '音频 1', index, kind: index ? 'video' : 'audio', locked: false, enabled: true, muted: false, solo: false })), { id: 'links-track-8', name: '音频 2', index: 8, kind: 'audio', locked: false, enabled: true, muted: false, solo: false }],
      clips: [
        { ...base, id: 'links-picture', name: '画面', kind: 'video', track: 1, sourceComponent: 'video' },
        { ...base, id: 'links-sound', name: '声音一', kind: 'audio', track: 0, sourceComponent: 'audio' },
        { ...base, id: 'links-sound-2', name: '声音二', kind: 'audio', track: 8, sourceComponent: 'audio' },
      ], annotations: [] }],
  }
  const file = path.join(ROOT, 'links.henji-video'); fs.writeFileSync(file, JSON.stringify(project))
  return { file, source, project }
}

function createVideoEditLinksScene() {
  return {
    id: 'video-edit-links', surface: '剪辑', name: '剪辑-链接片段联动、Alt单独操作与失步提示', writesUserData: true,
    setup: async (page, app, { capture }) => {
      const { file, source, project } = fixture()
      const original = { size: fs.statSync(source).size, mtime: fs.statSync(source).mtimeMs }
      const evidence = { project: file, steps: [] }; let client
      const store = () => fs.writeFileSync(path.join(ROOT, 'evidence.json'), JSON.stringify(evidence, null, 2))
      const ids = project.sequences[0].clips.map(clip => clip.id); const [picture, sound, sound2] = ids
      try {
        await button(page, '剪辑').click()
        if (await button(page, '关闭工程').isVisible()) await button(page, '关闭工程').click()
        await dialogs(app, [file], file); await button(page, '打开工程').click(); await presented(page, 0)
        const identity = await authorizeMcpConnection(page, { name: '剪辑链接验收', allowWrites: false, allowDestructive: false })
        client = await connectMcpClient(identity.config, 'Henji links Reality')
        const view = async () => (await callTool(client, 'read_application_entity', { ref: { kind: 'video_edit.project', id: project.id }, propertyIds: ['video_edit.project.timeline_view'] })).data.properties['video_edit.project.timeline_view']
        const clips = () => readProject(file).sequences[0].clips

        await label(page, sound, '声音一').click()
        assert.deepEqual(new Set((await view()).selectedClipIds), new Set(ids)); evidence.steps.push('链接选择开启：点击声音选中画面与两条声音')

        await page.keyboard.down('Alt')
        try {
          await label(page, sound, '声音一').click()
          assert.deepEqual((await view()).selectedClipIds, [sound])
          const start = await pointOn(page, sound)
          evidence.dragGeometry = { start, viewport: await page.locator('[data-video-edit-timeline-viewport]').evaluate(host => { const rect = host.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, scrollTop: host.scrollTop, scrollLeft: host.scrollLeft } }), rows: await page.locator('[data-video-edit-track]').evaluateAll(rows => rows.map(row => { const rect = row.getBoundingClientRect(); return { index: row.getAttribute('data-track-index'), kind: row.getAttribute('data-track-kind'), top: rect.top, bottom: rect.bottom } })) }
          await page.mouse.move(start.x, start.y); await page.mouse.down()
          await page.mouse.move(start.x + 30, start.y, { steps: 12 })
          evidence.dragPreviewBadges = await badges(page)
          evidence.dragPreviewStart = await clipNode(page, sound).getAttribute('data-clip-start')
          evidence.dragPreviewFailure = await page.locator('[data-video-edit-timeline-viewport]').evaluate(host => host.innerText.match(/当前位置不能编辑[\s\S]{0,120}/)?.[0] ?? null)
          await page.mouse.up()
          evidence.afterDrag = { view: await view(), toast: await page.evaluate(() => [...document.querySelectorAll('[role="alert"],[role="status"]')].map(node => node.textContent).filter(Boolean).slice(0, 5)) }
          await capture('video-edit-links-after-alt-drag')
        } finally { await page.keyboard.up('Alt') }
        let document = await saved(page, file, value => value.sequences[0].clips.find(clip => clip.id === sound).start === 15, 'Alt 单独拖动没有只移动声音一')
        assert.deepEqual(document.sequences[0].clips.map(clip => [clip.id, clip.start, clip.linkId]), [[picture, 0, 'links-take'], [sound, 15, 'links-take'], [sound2, 0, 'links-take']])
        evidence.outOfSyncBadges = await badges(page); assert.deepEqual(evidence.outOfSyncBadges, { [sound]: '+15' })
        await capture('video-edit-links-out-of-sync'); evidence.steps.push('Alt 单选拖动声音一 15 帧，链接保留并显示 +15')

        await clipNode(page, sound).click({ button: 'right' })
        await page.getByRole('menuitem', { name: /滑入同步/ }).waitFor()
        await page.waitForTimeout(400); await capture('video-edit-links-sync-menu')
        await page.getByRole('menuitem', { name: /移入同步/ }).click()
        await saved(page, file, value => value.sequences[0].clips.every(clip => clip.start === 0), '移入同步没有恢复原位置')
        await page.waitForFunction(() => !document.querySelector('[data-video-edit-sync-offset]'))
        evidence.steps.push('右键移入同步恢复，失步提示消失')

        const toggle = button(page, '链接选择')
        assert.equal(await toggle.getAttribute('aria-pressed'), 'true')
        await toggle.click(); assert.equal(await toggle.getAttribute('aria-pressed'), 'false'); assert.equal((await view()).linkedSelection, false)
        await label(page, picture, '画面').click(); assert.deepEqual((await view()).selectedClipIds, [picture])
        await toggle.click(); assert.equal((await view()).linkedSelection, true)
        evidence.steps.push('链接选择关闭后点击只选画面，开关经时间线视图读回')

        await button(page, '剃刀工具').click()
        const razorAt = await pointOn(page, picture, 80)
        await page.mouse.click(razorAt.x, razorAt.y)
        document = await saved(page, file, value => value.sequences[0].clips.length === 6, '剃刀没有联动拆开整组')
        const cutFrame = document.sequences[0].clips.find(clip => clip.id === picture).duration
        const right = document.sequences[0].clips.filter(clip => clip.start === cutFrame)
        assert.equal(right.length, 3); assert.equal(new Set(right.map(clip => clip.linkId)).size, 1); assert.notEqual(right[0].linkId, 'links-take')
        evidence.razor = { cutFrame, rightLinks: right.map(clip => clip.linkId) }
        const rightSound = right.find(clip => clip.track === 0)
        const altRazorAt = await pointOn(page, rightSound.id, 40)
        await page.keyboard.down('Alt')
        try { await page.mouse.click(altRazorAt.x, altRazorAt.y) } finally { await page.keyboard.up('Alt') }
        document = await saved(page, file, value => value.sequences[0].clips.length === 7, 'Alt 剃刀没有只拆一条')
        assert.equal(document.sequences[0].clips.filter(clip => clip.linkId === rightSound.linkId).length, 4)
        assert.deepEqual(await badges(page), {})
        await capture('video-edit-links-razor'); evidence.steps.push('剃刀整组同帧拆开、右半成链；Alt 剃刀只拆声音并保持链接')

        await button(page, '选择工具').click()
        // An empty click inside the track area clears the selection (zero-size marquee).
        const clearSelection = async () => {
          const left = await pointOn(page, picture, 1); const empty = { x: left.x + 300, y: left.y }
          assert.equal(await page.evaluate(({ x, y }) => { const element = document.elementFromPoint(x, y); return Boolean(element?.closest('[data-video-edit-timeline-content]')) && !element.closest('[data-video-edit-clip]') }, empty), true, '清空选区的点击位置不在空白轨道')
          await page.mouse.click(empty.x, empty.y); assert.deepEqual((await view()).selectedClipIds, [])
        }
        await clearSelection()
        await clipNode(page, picture).click({ button: 'right' })
        assert.deepEqual(new Set((await view()).selectedClipIds), new Set(ids))
        await page.getByRole('menuitem', { name: /解除链接/ }).click()
        document = await saved(page, file, value => value.sequences[0].clips.filter(clip => clip.start === 0).every(clip => !clip.linkId), '解除链接没有清除左半关系')
        await clearSelection()
        await label(page, picture, '画面').click(); assert.deepEqual((await view()).selectedClipIds, [picture])
        evidence.steps.push('解除链接后点击画面只选画面')
        assert.deepEqual(clips().map(clip => clip.itemId), Array(7).fill('links-item'))
        await button(page, '关闭工程').click()
        assert.equal(fs.statSync(source).size, original.size); assert.equal(fs.statSync(source).mtimeMs, original.mtime)
        evidence.completed = true
      } finally {
        store()
        if (client) await client.close().catch(() => {}); await disableMcp(page).catch(() => {})
      }
    },
  }
}
module.exports = { createVideoEditLinksScene }
