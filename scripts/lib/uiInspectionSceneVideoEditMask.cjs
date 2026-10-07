const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { dialogs, saved, presented } = require('./uiInspectionSceneVideoEditMonitor.cjs')
const { openVideoEditFile } = require('./uiInspectionVideoEditDocuments.cjs')
const button = (page, name) => page.getByRole('button', { name, exact: true })

/**
 * 效果遮罩真实窗口回环：原 4K60 素材上，效果库双击加效果（自动切到效果控件）→ 建矩形遮罩 →
 * 在节目监视器上拖动整体并统计实际出画节奏、松手到最终画面的延迟 → 拖一个顶点只动这一个点。
 */
function createVideoEditMaskScene() {
  return { id: 'video-edit-mask', surface: '剪辑', name: '剪辑-效果遮罩拖动跟手与顶点编辑（原4K60）', writesUserData: true,
    setup: async (page, app, { capture }) => {
      const root = path.resolve('node_modules/.cache/video-edit-mask'); fs.mkdirSync(root, { recursive: true })
      const file = path.join(root, 'mask.henji-video')
      const evidence = { completed: false }
      const store = () => fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
      const project = JSON.parse(fs.readFileSync(path.resolve('node_modules/.cache/video-edit-scrub-original/scrub.henji-video'), 'utf8'))
      project.id = 'mask-drag'; project.name = '遮罩拖动原4K60'; project.revision = 0; project.sequences = [project.sequences[0]]
      const sequence = project.sequences[0]; sequence.id = 'mask-sequence'; sequence.clips = sequence.clips.filter(clip => clip.id === 'base')
      assert.equal(sequence.width, 3840); assert.equal(sequence.height, 2160)
      fs.writeFileSync(file, JSON.stringify(project))
      const clipOf = value => value.sequences[0].clips.find(clip => clip.id === 'base')

      await button(page, '剪辑').click()
      if (await button(page, '关闭项目').isVisible()) await button(page, '关闭项目').click()
      await page.evaluate(() => localStorage.removeItem('henji.videoEdit.dockLayout.v1'))
      await dialogs(app, [file], file); await openVideoEditFile(page, file); await presented(page, 0)
      await page.locator('[data-video-edit-clip="base"]').first().click()

      // 效果库与效果控件在同一组堆叠：双击后效果控件必须自动显示
      await page.locator('.dv-tab', { hasText: '效果' }).filter({ hasNotText: '控件' }).first().click()
      const entry = page.locator('[data-video-edit-effects-entry]', { hasText: '高斯模糊' }).first()
      await entry.waitFor({ state: 'visible' }); await entry.dblclick()
      let document = await saved(page, file, value => clipOf(value).effects?.length === 1)
      const effect = clipOf(document).effects[0]
      await page.locator(`[data-video-edit-effect="${effect.id}"]`).waitFor({ state: 'visible', timeout: 10000 })
      evidence.libraryDoubleClick = true; store()

      await button(page, '创建矩形遮罩').first().click()
      document = await saved(page, file, value => clipOf(value).effects[0].mask?.shapes?.length === 1)
      const before = clipOf(document).effects[0].mask.shapes[0].points
      assert.equal(before.length, 4)
      const shape = page.locator('[data-video-edit-mask-shape]').first(); await shape.waitFor({ state: 'visible' })
      await capture('mask-created')

      // 观察节目画面每次出画（data-requested-at 每次出画都会改写）
      await page.evaluate(() => {
        const canvas = document.querySelector('canvas[aria-label="剪辑画面"]')
        const frames = []; window.__maskFrames = frames
        new MutationObserver(() => frames.push({ at: performance.now(), requestedAt: Number(canvas.dataset.requestedAt), renderMs: Number(canvas.dataset.renderMs) })).observe(canvas, { attributes: true, attributeFilter: ['data-requested-at'] })
        const longTasks = []; window.__maskLongTasks = longTasks
        const moves = []; window.__maskMoves = moves
        window.addEventListener('pointermove', event => { if (event.buttons) moves.push(performance.now()) }, true)
        new PerformanceObserver(list => { for (const item of list.getEntries()) longTasks.push({ at: item.startTime, duration: item.duration }) }).observe({ type: 'longtask', buffered: false })
      })
      const box = await shape.boundingBox()
      const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      await page.mouse.move(start.x, start.y); await page.mouse.down()
      const dragStart = await page.evaluate(() => performance.now())
      const steps = 120
      for (let step = 1; step <= steps; step++) {
        await page.mouse.move(start.x + Math.sin(step / steps * Math.PI * 2) * box.width * 0.3, start.y + step * 0.4)
        await page.waitForTimeout(16)
      }
      const upAt = await page.evaluate(() => performance.now())
      await page.mouse.up()
      document = await saved(page, file, value => JSON.stringify(clipOf(value).effects[0].mask.shapes[0].points) !== JSON.stringify(before))
      await page.waitForTimeout(500)
      const observed = await page.evaluate(({ dragStart }) => ({
        frames: window.__maskFrames.filter(frame => frame.at >= dragStart), longTasks: window.__maskLongTasks.filter(task => task.at >= dragStart), moves: window.__maskMoves.filter(at => at >= dragStart),
      }), { dragStart })
      // 每次指针移动到下一次出画的延迟（自动化输入本身约 30–40ms 一步，出画率受输入频率限制，所以按延迟判断跟手）
      const latencies = observed.moves.map(at => observed.frames.find(frame => frame.requestedAt >= at)).map((frame, index) => frame ? frame.at - observed.moves[index] : Infinity)
      const sorted = latencies.slice().sort((a, b) => a - b)
      const lastMove = observed.moves[observed.moves.length - 1]
      const finalFrame = observed.frames.find(frame => frame.requestedAt >= lastMove)
      evidence.drag = {
        moves: observed.moves.length, presents: observed.frames.filter(frame => frame.at <= upAt).length,
        medianLatencyMs: sorted[Math.floor(sorted.length / 2)], p95LatencyMs: sorted[Math.floor(sorted.length * 0.95)],
        medianRenderMs: observed.frames.map(frame => frame.renderMs).sort((a, b) => a - b)[Math.floor(observed.frames.length / 2)],
        lastMoveToFinalMs: finalFrame ? finalFrame.at - lastMove : null, presentsAfterRelease: observed.frames.filter(frame => frame.at > upAt + 1).length,
        longTasks: observed.longTasks.length, longestTaskMs: Math.max(0, ...observed.longTasks.map(task => task.duration)),
      }
      store()
      assert.ok(evidence.drag.moves >= 100, `没有观察到拖动输入：${JSON.stringify(evidence.drag)}`)
      assert.ok(evidence.drag.medianLatencyMs < 34 && evidence.drag.p95LatencyMs < 60, `拖动遮罩不跟手：${JSON.stringify(evidence.drag)}`)
      assert.ok(evidence.drag.lastMoveToFinalMs !== null && evidence.drag.lastMoveToFinalMs < 60, `松手前最后位置没有及时出画：${JSON.stringify(evidence.drag)}`)
      assert.ok(evidence.drag.longestTaskMs < 50, `拖动时主线程有长任务：${JSON.stringify(evidence.drag)}`)
      await capture('mask-dragged')

      // 拖一个顶点：只动这个点，矩形变成任意四边形
      const moved = clipOf(document).effects[0].mask.shapes[0].points
      await shape.click()
      const vertex = page.locator('[data-video-edit-mask-handle="vertex-0"]').first(); await vertex.waitFor({ state: 'visible' })
      const handle = await vertex.boundingBox()
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down()
      await page.mouse.move(handle.x - 40, handle.y - 30, { steps: 8 }); await page.mouse.up()
      document = await saved(page, file, value => JSON.stringify(clipOf(value).effects[0].mask.shapes[0].points[0]) !== JSON.stringify(moved[0]))
      const after = clipOf(document).effects[0].mask.shapes[0].points
      assert.deepEqual(after.slice(1), moved.slice(1), '拖一个顶点不能移动其他顶点')
      assert.equal(await vertex.getAttribute('data-selected'), 'true')
      await capture('mask-vertex')
      evidence.vertexDrag = true; evidence.completed = true; store()
      return evidence
    },
  }
}

module.exports = { createVideoEditMaskScene }
