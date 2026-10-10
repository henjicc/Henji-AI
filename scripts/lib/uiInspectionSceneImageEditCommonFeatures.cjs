/* eslint-disable @typescript-eslint/no-var-requires -- 正式 Electron 巡检入口。 */
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs/promises')
const { blockPaidGeneration } = require('./uiReviewPaidGuard.cjs')
const { openCanvasImageEditorV3Fixture } = require('./uiInspectionCanvasImageEditorV3.cjs')

function createImageEditCommonFeaturesScene(context, canvas = false) {
  const source = '.reality/t142-4k.png'
  return {
    id: `image-edit-common-features-${canvas ? 'canvas' : 'toolbox'}`,
    surface: '图片编辑', name: '4K 常用功能和输入呈现分阶段测量', writesUserData: true,
    ...(canvas ? {} : { launchArgs: ['--dev-surface=tool.image_edit', `--dev-media=${source}`] }),
    setup: async (page, app, { capture }) => {
      const restorePaid = await blockPaidGeneration(app)
      let host = page.locator('[data-image-editor-v3]:visible').last()
      const output = path.resolve(`.reality/t142-${process.env.HENJI_IMAGE_INTERACTION_LABEL || 'after'}-${canvas ? 'canvas' : 'toolbox'}-latency.json`)
      const tab = async id => { await host.locator(`[data-dock-tab="${id}"] > span`).first().click(); await context.settlePage(page, 150) }
      const press = async key => { await host.focus(); await page.keyboard.press(key) }
      const metrics = []
      const measure = async (name, operation) => {
        await page.evaluate(() => performance.clearMeasures('image-editor-interaction'))
        const tracing = name === 'text-input' && process.env.HENJI_IMAGE_INTERACTION_TRACE_TEXT === '1'
          ? await page.context().newCDPSession(page) : null
        if (tracing) await tracing.send('Tracing.start', {
          categories:'blink,cc,gpu,toplevel,devtools.timeline,disabled-by-default-devtools.timeline.inputs', transferMode:'ReturnAsStream',
        })
        // 矢量手势走 DOM 覆盖层：记录实际 DOM 更新后进入下一帧回调的时间，
        // 与 GPU 提交分开报告，不把 RAF 间隔或显示器扫描时间冒充实际延迟。
        const overlayObserver = await host.evaluateHandle(root => {
          const frames = new Map()
          const longTasks = []
          const tasks = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(entry => ({start:entry.startTime,duration:entry.duration}))))
          tasks.observe({type:'longtask'})
          const schedule = () => {
            const input = performance.getEntriesByName('image-editor-interaction').findLast(entry => entry.detail.stage === 'input')?.detail
            if (!input || frames.has(input.sequence)) return
            frames.set(input.sequence, requestAnimationFrame(() => {
              performance.measure('image-editor-interaction', {start:input.inputTimestamp,end:performance.now(),detail:{...input,stage:'overlay-frame-ready',quality:'draft'}})
            }))
          }
          const observer = new MutationObserver(records => {
            if(records.some(record => record.target instanceof Element && record.target.closest('[data-vector-overlay] svg'))) schedule()
          })
          observer.observe(root, {subtree:true,attributes:true,childList:true,characterData:true})
          const input = event => { if(event.target instanceof Element && event.target.closest('[data-vector-overlay] textarea, [data-vector-properties] textarea')) schedule() }
          root.addEventListener('input',input)
          return {stop:() => {observer.disconnect();tasks.disconnect();root.removeEventListener('input',input);for(const frame of frames.values()) cancelAnimationFrame(frame);return longTasks}}
        })
        let longTasks = []
        try { await operation(); await context.settlePage(page, 5000) }
        finally {
          longTasks = await overlayObserver.evaluate(observer => observer.stop()); await overlayObserver.dispose()
          if (tracing) {
            const completed = new Promise(resolve => tracing.once('Tracing.tracingComplete', resolve))
            await tracing.send('Tracing.end')
            const {stream} = await completed
            const chunks = []
            for (;;) {
              const chunk = await tracing.send('IO.read', {handle:stream})
              chunks.push(chunk.base64Encoded ? Buffer.from(chunk.data, 'base64').toString('utf8') : chunk.data)
              if (chunk.eof) break
            }
            await tracing.send('IO.close', {handle:stream}); await tracing.detach()
            await fs.writeFile(output.replace('-latency.json', '-typing-trace.json'), chunks.join(''))
          }
        }
        const entries = await page.evaluate(() => performance.getEntriesByName('image-editor-interaction').map(entry => ({ elapsedMs: entry.duration, ...entry.detail })))
        const presented = new Map()
        for (const entry of entries) if (entry.stage === 'present' && !presented.has(entry.sequence)) presented.set(entry.sequence, entry)
        const samples = [...presented.values()].filter(entry => entry.inputType !== 'pointerup').map(entry => entry.elapsedMs).sort((a,b) => a-b)
        const final = [...presented.values()].filter(entry => entry.inputType === 'pointerup')
        const inputs = entries.filter(entry => entry.stage === 'input')
        const lastInput = inputs.at(-1)
        const stable = entries.find(entry => entry.stage === 'present' && entry.sequence === lastInput?.sequence && entry.quality === 'stable')
        const overlaySamples = entries.filter(entry => entry.stage === 'overlay-frame-ready').map(entry => entry.elapsedMs).sort((a,b) => a-b)
        metrics.push({ name, inputCount: new Set(inputs.map(entry => entry.sequence)).size, presentedCount: presented.size, p95Ms: samples.length ? samples[Math.ceil(samples.length * .95) - 1] : null, overlaySamples:overlaySamples.length, overlayP95Ms:overlaySamples.length ? overlaySamples[Math.ceil(overlaySamples.length*.95)-1] : null, finalPreviewMs: final.at(-1)?.elapsedMs ?? null, finalMs: stable?.elapsedMs ?? null, longTasks, entries })
        await fs.writeFile(output, JSON.stringify(metrics, null, 2))
        await capture(name)
      }
      try {
        // 与已有画布性能场景一致：临时巡检窗口持续出帧，不受后台或遮挡节流影响。
        const windowState = await app.evaluate(({BrowserWindow}, url) => {
          const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === url)
          if (!window) throw new Error('正式巡检窗口不存在')
          window.webContents.setBackgroundThrottling(false)
          return {visible:window.isVisible(),minimized:window.isMinimized(),focused:window.isFocused(),backgroundThrottling:window.webContents.getBackgroundThrottling()}
        }, page.url())
        await fs.writeFile(path.resolve(`.reality/t142-window-${canvas ? 'canvas' : 'toolbox'}.json`), JSON.stringify(windowState, null, 2))
        if (canvas) ({ editor: host } = await openCanvasImageEditorV3Fixture({ page, context, width:3840, height:2160, sourcePath:path.resolve(source), label:'4K 常用功能' }))
        await host.waitFor({ timeout:60000 })
        await host.locator('[data-raster-source-ready="true"]').first().waitFor({ state:'attached', timeout:60000 })
        await context.settlePage(page, 2000)
        await capture('opened-4k')
        await measure('zoom-actual', () => press('Control+1'))
        const surface = host.locator('[data-preview-surface]')
        const bounds = await surface.boundingBox(); assert.ok(bounds)
        await measure('pan', async () => {
          await page.keyboard.down('Space')
          await page.mouse.move(bounds.x + bounds.width * .4, bounds.y + bounds.height * .45); await page.mouse.down()
          await page.mouse.move(bounds.x + bounds.width * .65, bounds.y + bounds.height * .6, { steps:40 })
          await page.mouse.up(); await page.keyboard.up('Space')
        })
        await press('Control+0'); await tab('adjustments')
        await host.getByRole('button', { name:'添加滤镜或调整', exact:true }).click()
        await page.getByRole('menuitem', { name:'曝光', exact:true }).click()
        await context.settlePage(page, 2000)
        const slider = host.locator('[data-filter-parameters]').getByRole('slider').first()
        await slider.scrollIntoViewIfNeeded()
        const box = await slider.boundingBox(); assert.ok(box)
        await measure('exposure', async () => {
          await page.mouse.move(box.x + box.width * .5, box.y + box.height * .5); await page.mouse.down()
          await page.mouse.move(box.x + box.width * .54, box.y + box.height * .5, { steps:40 }); await page.mouse.up()
        })
        await tab('layers'); await host.locator('[data-layer-select]').first().click(); await press('t')
        const vector = host.locator('[data-vector-overlay]'), area = await vector.boundingBox(); assert.ok(area)
        await vector.click({ position:{ x:area.width * .25, y:area.height * .3 } })
        const text = vector.getByRole('textbox', { name:'文字内容', exact:true })
        // 普通键盘连续输入、整段中文输入与正式图层提交分别报告。
        // 每个中文字符调用 Input.insertText 的诊断数据保留在记录中，不能当作键盘采样。
        await measure('text-input', () => text.pressSequentially('4K clipboard and mosaic', {delay:16}))
        if (process.env.HENJI_IMAGE_INTERACTION_FOCUS === 'typing-zoom') {
          // 截图另做一轮，避免 capturePage 耗时污染键盘延迟样本。
          await text.fill('')
          for (const [index, character] of [...'连续文字输入'].entries()) {
            await text.pressSequentially(character)
            await capture(`typing-frame-${index}`)
          }
        }
        await measure('text-composition', () => text.fill('4K 常用编辑：复制粘贴与马赛克'))
        await measure('text', () => text.press('Enter'))
        if (process.env.HENJI_IMAGE_INTERACTION_FOCUS === 'typing-zoom') {
          const layerText = host.getByRole('textbox', { name: '图层文字内容', exact: true })
          await layerText.waitFor()
          const original = await layerText.inputValue()
          const revision = () => host.locator('[data-command-bar]').getAttribute('data-document-revision').then(Number)
          const beforeTyping = await revision()
          await layerText.focus(); await layerText.press('End')
          await measure('layer-text-input', () => layerText.pressSequentially(' continued', { delay: 16 }))
          assert.equal(await revision(), beforeTyping + 1, '停顿只提交一次文字内容修改')
          await host.focus(); await context.settlePage(page, 100)
          assert.equal(await revision(), beforeTyping + 1, '停顿提交之后失焦不得重复提交')
          await press('Control+z'); await context.settlePage(page, 500)
          assert.equal(await layerText.inputValue(), original, '一步撤销读回连续输入前的文字')
          await capture('layer-text-undo')
          if (process.env.HENJI_IMAGE_INTERACTION_ASSERT_BUDGET === '1') {
            const typing = metrics.find(metric => metric.name === 'text-input')
            const zoom = metrics.find(metric => metric.name === 'zoom-actual')
            assert.equal(typing.overlaySamples, 23, '连续键盘输入必须保留全部 23 个 RAF 样本')
            assert.ok(typing.overlayP95Ms <= 33, `连续文字 P95 超预算：${typing.overlayP95Ms}ms`)
            const layerTyping = metrics.find(metric => metric.name === 'layer-text-input')
            assert.ok(layerTyping.overlayP95Ms !== null && layerTyping.overlayP95Ms <= 33,
              `文字属性连续输入 P95 超预算：${layerTyping.overlayP95Ms}ms`)
            assert.ok(zoom.finalMs !== null && zoom.finalMs <= 300, `冷缩放终态超预算：${zoom.finalMs}ms`)
          }
          return
        }
        await host.getByRole('button', { name:'文字与图形', exact:true }).click()
        await page.getByRole('menuitem', { name:'矩形', exact:true }).click()
        await measure('shape', async () => {
          await page.mouse.move(area.x + area.width * .35, area.y + area.height * .3); await page.mouse.down()
          await page.mouse.move(area.x + area.width * .65, area.y + area.height * .7, { steps:30 }); await page.mouse.up()
        })
        await tab('layers'); await host.locator('[data-layer-type="raster"] [data-layer-select]').first().click()
        await press('v')
        const drag = async (x, y, dx, dy) => {
          await page.mouse.move(x,y); await page.mouse.down(); await page.mouse.move(x + dx,y + dy,{ steps:40 }); await page.mouse.up()
        }
        const content = await host.locator('[data-viewport-content]').boundingBox(); assert.ok(content)
        const revision = async () => Number(await host.locator('[data-command-bar]').getAttribute('data-document-revision'))
        const beforeMove = await revision()
        await measure('layer-move', () => drag(content.x + content.width * .1,content.y + content.height * .85,20,-10))
        assert.equal(await revision(),beforeMove + 1,'移动必须实际命中并只提交一次')
        await host.locator('[data-layer-type="raster"] [data-layer-select]').first().click()
        const handle = host.locator('[data-layer-transform-handle="se"]')
        await handle.waitFor()
        const corner = await handle.boundingBox(); assert.ok(corner)
        const beforeScale = await revision()
        await measure('layer-scale', () => drag(corner.x + corner.width * .5,corner.y + corner.height * .5,-25,-20))
        assert.equal(await revision(),beforeScale + 1,'缩放必须实际命中并只提交一次')
        await press('v')
        if (process.env.HENJI_IMAGE_INTERACTION_LABEL?.startsWith('after')) {
          await press('v'); await press('Control+c')
          await context.settlePage(page, 500)
          await host.getByRole('button', { name: '取消', exact: true }).waitFor({ state: 'hidden', timeout: 60000 })
          const clipboardState = await app.evaluate(({ clipboard }) => { const image = clipboard.readImage(); return { empty: image.isEmpty(), size: image.getSize(), formats: clipboard.availableFormats() } })
          await fs.writeFile(path.resolve(`.reality/t142-copy-${canvas ? 'canvas' : 'toolbox'}.json`), JSON.stringify(clipboardState, null, 2))
          assert.equal(await host.locator('[data-image-edit-clipboard-error]').count(), 0, `复制不得出现用户可见失败：${await host.locator('[data-image-edit-clipboard-error]').allTextContents()}`)
          assert.equal(clipboardState.empty, false, '必须从真实系统剪贴板读回图片')
          const beforePaste = await revision()
          await press('Control+v'); await context.settlePage(page, 1500)
          await host.getByRole('button', { name: '取消', exact: true }).waitFor({ state: 'hidden', timeout: 60000 })
          assert.equal(await host.locator('[data-image-edit-clipboard-error]').count(), 0, '内部图层粘贴不得出现用户可见失败')
          assert.equal(await revision(), beforePaste + 1, '内部图层粘贴必须实际提交一次')
          await host.locator('[data-layer-type="group"]').first().waitFor()
          await capture('clipboard-editable-layer')
          await press('Control+z'); await context.settlePage(page, 500)
          assert.equal(await revision(), beforePaste + 2, '粘贴必须可撤销')
          assert.equal(await host.locator('[data-layer-type="group"]').count(), 0, '撤销须移除粘贴组')
          await press('Control+Shift+c'); await context.settlePage(page, 500)
          await host.getByRole('button', { name: '取消', exact: true }).waitFor({ state: 'hidden', timeout: 60000 })
          const beforeCompositePaste = await revision()
          await press('Control+v'); await context.settlePage(page, 1500)
          await host.getByRole('button', { name: '取消', exact: true }).waitFor({ state: 'hidden', timeout: 60000 })
          assert.equal(await host.locator('[data-image-edit-clipboard-error]').count(), 0, '合成位图粘贴不得出现用户可见失败')
          assert.equal(await revision(), beforeCompositePaste + 1, '合成位图必须实际粘贴一次')
          assert.equal(await host.locator('[data-layer-type="raster"]').count(), 2, '合成结果应成为新位图层')
          await capture('clipboard-composite-layer')
          await tab('adjustments')
          await host.getByRole('button', { name: '添加滤镜或调整', exact: true }).click()
          await page.getByRole('menuitem', { name: '马赛克', exact: true }).click()
          await context.settlePage(page, 3000)
          await capture('mosaic-filter-layer')
          const mosaicStrength = host.locator('[data-filter-parameters]').getByRole('spinbutton', {name:'色块大小',exact:true})
          await mosaicStrength.scrollIntoViewIfNeeded()
          const mosaicBox = await mosaicStrength.boundingBox(); assert.ok(mosaicBox)
          await measure('mosaic-strength', async () => {
            await page.mouse.move(mosaicBox.x + mosaicBox.width * .5, mosaicBox.y + mosaicBox.height * .5)
            await page.mouse.down()
            await page.mouse.move(mosaicBox.x + mosaicBox.width * .5 + 40, mosaicBox.y + mosaicBox.height * .5, {steps:40})
            await page.mouse.up()
          })
        }
        // 帧序列单独采集，不把 capturePage 的耗时混入上述连续交互分位数。
        await press('v'); await page.keyboard.down('Space')
        await page.mouse.move(bounds.x + bounds.width * .45, bounds.y + bounds.height * .45); await page.mouse.down()
        for (let index = 0; index < 8; index++) {
          await page.mouse.move(bounds.x + bounds.width * (.45 + index * .02), bounds.y + bounds.height * .45)
          await capture(`pan-frame-${index}`)
          assert.equal(await host.locator('[data-preview-surface]').getAttribute('data-preview-composition-backend'), 'gpu',
            '开启马赛克后的平移帧不能退回旧 CPU 底图')
        }
        await page.mouse.up(); await page.keyboard.up('Space')
        assert.ok(metrics.some(metric => metric.presentedCount > 0), '必须有绑定输入的实际呈现数据')
        assert.ok(metrics.filter(metric => ['text','shape'].includes(metric.name)).every(metric => metric.presentedCount > 0), '文字、形状提交必须有实际画面，不能仅等待后截图')
      } finally {
        await page.mouse.up(); await page.keyboard.up('Space'); await restorePaid()
      }
    },
  }
}
function createImageEditQuickMosaicScene(context) {
  return {
    id: 'image-edit-quick-mosaic', surface: '生成', name: '快速标记共享马赛克、选区与蒙版画笔', writesUserData: true,
    setup: async (page, app, { capture }) => {
      const restore = await blockPaidGeneration(app)
      try {
        await context.selectGenerationModel(page, 'Nano Banana 2', 'kie-nano-banana-2', 'kie')
        const previous = await page.locator('img[alt^="参考 "]').count()
        await page.locator('input[type="file"][accept*="image"]').first().setInputFiles('.reality/t142-4k.png')
        const image = page.locator(`img[alt="参考 ${previous + 1}"]`)
        await image.waitFor(); await image.evaluate(image => image.decode()); await image.click()
        const viewer = page.getByRole('dialog', { name:'图片', exact:true })
        await viewer.getByRole('button', { name:'编辑', exact:true }).click()
        const host = viewer.locator('[data-image-editor-v3][data-host-profile="quick"]')
        await host.locator('[data-raster-source-ready="true"]').first().waitFor({state:'attached', timeout:60000})
        await context.settlePage(page,1500)
        await host.locator('[data-tool-id="select-rect"]').click()
        await page.keyboard.press('Escape')
        const selection = host.locator('[data-tool-overlay-slot="selection"] svg'), rect = await selection.boundingBox(); assert.ok(rect)
        await page.mouse.move(rect.x + rect.width * .3,rect.y + rect.height * .3); await page.mouse.down()
        await page.mouse.move(rect.x + rect.width * .7,rect.y + rect.height * .55,{steps:12}); await page.mouse.up()
        await context.settlePage(page,500)
        await capture('quick-selection')
        await host.getByRole('button', {name:'添加图层',exact:true}).click()
        await page.getByRole('menuitem',{name:'马赛克',exact:true}).click()
        await host.locator('[data-layer-type="effect"]').waitFor({timeout:60000})
        await context.settlePage(page,2000); await capture('quick-mosaic-selection')
        await host.getByRole('button', {name:'取消选区',exact:true}).click()
        await host.locator('[data-tool-id="mask-edit"]').click()
        await host.locator('[data-paint-options]').waitFor()
        await host.getByRole('spinbutton', { name:'大小', exact:true }).fill('160')
        await host.getByRole('spinbutton', { name:'大小', exact:true }).press('Enter')
        await host.getByRole('spinbutton', { name:'蒙版覆盖', exact:true }).fill('100')
        await host.getByRole('spinbutton', { name:'蒙版覆盖', exact:true }).press('Enter')
        await host.focus()
        const brush = host.locator('[data-raster-brush-overlay]'), brushRect = await brush.boundingBox(); assert.ok(brushRect)
        const revision = Number(await host.locator('[data-command-bar]').getAttribute('data-document-revision'))
        await capture('quick-brush-ready')
        await page.mouse.move(brushRect.x + brushRect.width * .3,brushRect.y + brushRect.height * .8); await page.mouse.down()
        await page.mouse.move(brushRect.x + brushRect.width * .65,brushRect.y + brushRect.height * .8,{steps:16}); await page.mouse.up()
        await page.waitForFunction(revision => Number(document.querySelector('[data-image-editor-v3][data-host-profile="quick"] [data-command-bar]')?.getAttribute('data-document-revision')) === revision + 1, revision, {timeout:60000})
        await context.settlePage(page,1500)
        await capture('quick-mosaic-mask-brush')
      } finally { await page.mouse.up(); await restore() }
    },
  }
}
module.exports = { createImageEditCommonFeaturesScene, createImageEditQuickMosaicScene }
