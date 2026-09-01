function createToolboxScenes(context) {
  const {
    settlePage,
    clickNamedButton,
    setupToolbox,
    setupCameraStageProjectList,
    setupCameraStageStyledEditor,
  } = context

  return [
    { id: 'toolbox-home', surface: '工具箱', name: '工具箱-首页', setup: setupToolbox },
    {
      id: 'toolbox-hover',
      surface: '工具箱',
      name: '工具箱-入口悬浮',
      setup: async (page) => {
        await setupToolbox(page)
        await page.locator('[data-ui-page-header] + div button:visible').first().hover()
        await settlePage(page)
      },
    },
    {
      id: 'toolbox-image-edit',
      surface: '工具箱',
      name: '工具箱-图片编辑空态',
      setup: async (page) => {
        await setupToolbox(page)
        await clickNamedButton(page, /^(图片编辑|Image Edit)/i)
        await page.locator('[data-application-surface-id="tool.image_edit"]:visible').waitFor({ state: 'visible', timeout: 12000 })
        await page.getByRole('button', { name: /^(从文件打开|Open from file)$/i }).waitFor({ state: 'visible', timeout: 12000 })
        await settlePage(page, 700)
      },
    },
    {
      id: 'toolbox-image-edit-vgpu-glow',
      surface: '工具箱',
      name: '工具箱-图片编辑辉光 Pro',
      setup: async (page) => {
        const openGlowEditor = async () => {
          await setupToolbox(page)
          await clickNamedButton(page, /^(图片编辑|Image Edit)/i)
          const surface = page.locator('[data-application-surface-id="tool.image_edit"]:visible')
          await surface.waitFor({ state: 'visible', timeout: 12000 })
          const addLayerButton = page.getByRole('button', { name: /^(添加图层|Add layer)$/i })
          const dropTarget = surface.locator('.border-dashed').first()
          await Promise.race([
            addLayerButton.waitFor({ state: 'visible', timeout: 12000 }),
            dropTarget.waitFor({ state: 'visible', timeout: 12000 }),
          ])
          if (await dropTarget.isVisible()) {
            const fixturePath = process.env.HENJI_VGPU_GLOW_FIXTURE_IMAGE
            const [{ readFile }, { basename }] = fixturePath
              ? await Promise.all([import('node:fs/promises'), import('node:path')])
              : [{ readFile: null }, { basename: null }]
            const externalFixture = fixturePath ? {
              bytes: Array.from(await readFile(fixturePath)),
              name: basename(fixturePath),
              type: fixturePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg',
            } : null
            await dropTarget.evaluate(async (element, fixture) => {
            if (fixture) {
              const transfer = new DataTransfer()
              transfer.items.add(new File(
                [Uint8Array.from(fixture.bytes)],
                fixture.name,
                { type: fixture.type }
              ))
              element.dispatchEvent(new DragEvent('drop', {
                bubbles: true,
                cancelable: true,
                dataTransfer: transfer,
              }))
              return
            }
            const canvas = document.createElement('canvas')
            canvas.width = 1200
            canvas.height = 760
            const context = canvas.getContext('2d')
            if (!context) throw new Error('辉光夹具画布不可用')
            const background = context.createRadialGradient(600, 360, 40, 600, 360, 760)
            background.addColorStop(0, 'rgb(24, 34, 62)')
            background.addColorStop(1, 'rgb(5, 7, 13)')
            context.fillStyle = background
            context.fillRect(0, 0, canvas.width, canvas.height)
            for (const [x, y, radius, color, width] of [
              [310, 330, 70, 'rgb(57, 216, 255)', 14],
              [610, 235, 54, 'rgb(255, 62, 201)', 11],
              [870, 420, 82, 'rgb(255, 156, 50)', 16],
            ]) {
              context.strokeStyle = color
              context.lineWidth = width
              context.beginPath()
              context.arc(x, y, radius, 0, Math.PI * 2)
              context.stroke()
            }
            context.fillStyle = 'rgb(37, 232, 198)'
            context.beginPath()
            context.arc(145, 590, 58, 0, Math.PI * 2)
            context.fill()
            context.strokeStyle = 'rgb(235, 241, 255)'
            context.lineWidth = 8
            context.beginPath()
            context.moveTo(260, 530)
            context.lineTo(940, 530)
            context.stroke()
            context.fillStyle = 'rgb(220, 233, 255)'
            context.font = '48px sans-serif'
            context.textAlign = 'center'
            context.fillText('VGPU GLOW', 600, 650)
            const blob = await new Promise((resolve, reject) => canvas.toBlob(
              (value) => value ? resolve(value) : reject(new Error('辉光夹具编码失败')),
              'image/png'
            ))
            const transfer = new DataTransfer()
            transfer.items.add(new File([blob], 'vgpu-glow-fixture.png', { type: 'image/png' }))
            element.dispatchEvent(new DragEvent('drop', {
              bubbles: true,
              cancelable: true,
              dataTransfer: transfer,
            }))
            }, externalFixture)
          }
          await addLayerButton.waitFor({ state: 'visible', timeout: 12000 })
          const existingGlow = surface.locator('[role="treeitem"][data-layer-type="effect"]')
            .filter({ hasText: '辉光 Pro' }).first()
          if (await existingGlow.count()) {
            await existingGlow.locator('[data-layer-select]').click()
          } else {
            await addLayerButton.click()
            await page.getByRole('menuitem', { name: '辉光 Pro' }).click()
          }
          await page.getByRole('slider', { name: '辉光强度' }).waitFor({ state: 'visible', timeout: 8000 })
          await settlePage(page, 1200)
        }

        // 第一轮主动推进多次 revision，再重新打开编辑器。旧实现的 Worker 记住了全局最大值，
        // 第二轮从 revision 1 起步会被永久判旧；这个场景必须在同一 Electron 进程里复现它。
        await openGlowEditor()
        const intensity = page.getByRole('slider', { name: '辉光强度' })
        await intensity.focus()
        for (let index = 0; index < 6; index += 1) await intensity.press('ArrowRight')
        await settlePage(page, 1200)
        await page.getByRole('button', { name: '返回工具箱' }).click()
        await openGlowEditor()
        const radius = page.getByRole('slider', { name: '半径' })
        await radius.fill('0.78')
        await radius.press('ArrowLeft')
        await page.getByRole('button', { name: '下移图层' }).click()
        await page.getByRole('button', { name: '上移图层' }).click()
        if (await page.getByText('辉光预览失败').count()) {
          throw new Error('重新打开图片编辑器后，辉光预览仍被旧会话 revision 取消')
        }
        await settlePage(page, 2200)
      },
    },
    {
      id: 'image-editor-v3-release',
      surface: '工具箱',
      name: '图片编辑器 V3-发布候选核心路径',
      writesUserData: true,
      setup: async (page) => {
        const startedAt = new Date().toISOString()
        await setupToolbox(page)
        await clickNamedButton(page, /^(图片编辑|Image Edit)/i)
        const host = page.locator('[data-application-surface-id="tool.image_edit"]:visible')
        await host.waitFor({ state: 'visible', timeout: 12000 })
        const dropTarget = host.locator('.border-dashed').first()
        await dropTarget.waitFor({ state: 'visible', timeout: 12000 })
        await dropTarget.evaluate(async (element) => {
          const canvas = document.createElement('canvas')
          canvas.width = 1600
          canvas.height = 1000
          const context = canvas.getContext('2d')
          if (!context) throw new Error('发布候选 JPG 夹具画布不可用')
          const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height)
          gradient.addColorStop(0, 'rgb(22, 48, 92)')
          gradient.addColorStop(0.55, 'rgb(216, 90, 76)')
          gradient.addColorStop(1, 'rgb(252, 203, 92)')
          context.fillStyle = gradient
          context.fillRect(0, 0, canvas.width, canvas.height)
          context.fillStyle = 'rgb(245, 248, 255)'
          context.fillRect(230, 220, 420, 300)
          context.fillStyle = 'rgb(20, 26, 42)'
          context.font = '72px sans-serif'
          context.fillText('V3 JPEG', 780, 620)
          const blob = await new Promise((resolve, reject) => canvas.toBlob(
            (value) => value ? resolve(value) : reject(new Error('发布候选 JPG 编码失败')),
            'image/jpeg',
            0.9,
          ))
          const transfer = new DataTransfer()
          transfer.items.add(new File([blob], 'image-editor-v3-release.jpg', { type: 'image/jpeg' }))
          element.dispatchEvent(new DragEvent('drop', {
            bubbles: true,
            cancelable: true,
            dataTransfer: transfer,
          }))
        })

        const editor = host.locator('[data-image-editor-v3]')
        await editor.waitFor({ state: 'visible', timeout: 15000 })
        const raster = editor.locator('[role="treeitem"][data-layer-type="raster"][aria-selected="true"]')
        await raster.waitFor({ state: 'visible', timeout: 12000 })
        const preview = editor.locator('[data-preview-surface]')
        await preview.waitFor({ state: 'visible', timeout: 12000 })
        await page.waitForFunction(() => (
          document.querySelector('[data-preview-surface]')?.getAttribute('data-move-availability') === 'ready'
        ), undefined, { timeout: 15000 })
        await page.waitForFunction(() => (
          document.querySelector('[data-preview-surface]')?.getAttribute('data-preview-display-source') === 'viewport'
            && document.querySelectorAll('[data-viewport-tile]').length > 0
        ), undefined, { timeout: 15000 })

        const readRevision = async () => {
          const label = await editor.getByText(/^(版本|Revision) \d+$/).first().textContent()
          const revision = Number(label?.match(/\d+/)?.[0])
          if (!Number.isSafeInteger(revision)) throw new Error('无法读取图片编辑 revision')
          return revision
        }
        const beforeMove = await readRevision()
        const previewBox = await preview.boundingBox()
        if (!previewBox) throw new Error('图片编辑预览没有可交互范围')
        const startX = previewBox.x + previewBox.width * 0.5
        const startY = previewBox.y + previewBox.height * 0.5
        const feedback = editor.locator('[data-move-feedback-frame]')
        const rasterFrame = editor.locator('[data-raster-display-frame]')
        const initialFeedbackBox = await feedback.boundingBox()
        const initialRasterFrameBox = await rasterFrame.boundingBox()
        if (!initialFeedbackBox || !initialRasterFrameBox) {
          throw new Error('移动 JPG 前无法读取稳定画面边界')
        }
        await page.mouse.move(startX, startY)
        await page.mouse.down()
        const pressedSource = await preview.getAttribute('data-preview-display-source')
        const pressedFeedbackBox = await feedback.boundingBox()
        if (pressedSource !== 'viewport'
          || !pressedFeedbackBox
          || Math.abs(pressedFeedbackBox.x - initialFeedbackBox.x) > 0.5
          || Math.abs(pressedFeedbackBox.y - initialFeedbackBox.y) > 0.5) {
          throw new Error('按下移动工具时稳定画面发生了闪跳或显示源切换')
        }
        for (let step = 1; step <= 6; step += 1) {
          const expectedX = 42 * step / 6
          const expectedY = -180 * step / 6
          await page.mouse.move(startX + expectedX, startY + expectedY)
          await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())))
          const [source, currentFeedbackBox, currentRasterFrameBox, revision] = await Promise.all([
            preview.getAttribute('data-preview-display-source'),
            feedback.boundingBox(),
            rasterFrame.boundingBox(),
            readRevision(),
          ])
          if (source !== 'viewport') throw new Error('移动 JPG 期间稳定分块画面被草稿替换')
          if (revision !== beforeMove) throw new Error('移动 JPG 期间提前提交了文档 revision')
          if (!currentFeedbackBox || !currentRasterFrameBox) throw new Error('移动 JPG 期间画面边界丢失')
          if (Math.abs(currentFeedbackBox.x - initialFeedbackBox.x - expectedX) > 1.5
            || Math.abs(currentFeedbackBox.y - initialFeedbackBox.y - expectedY) > 1.5) {
            throw new Error('移动 JPG 的实际画面位置没有跟随指针')
          }
          if (Math.abs(currentRasterFrameBox.x - initialRasterFrameBox.x) > 0.5
            || Math.abs(currentRasterFrameBox.y - initialRasterFrameBox.y) > 0.5
            || Math.abs(currentRasterFrameBox.width - initialRasterFrameBox.width) > 0.5
            || Math.abs(currentRasterFrameBox.height - initialRasterFrameBox.height) > 0.5) {
            throw new Error('移动 JPG 期间文档裁切边界跟随内容发生了偏移')
          }
        }
        const transientTransform = await feedback.evaluate(
          (element) => element.style.transform,
        )
        if (!transientTransform.includes('translate')) {
          throw new Error('移动 JPG 时没有即时位移反馈')
        }
        await page.mouse.up()
        await page.waitForFunction((revision) => {
          const labels = [...document.querySelectorAll('[data-command-bar] span')]
          return labels.some((element) => Number(element.textContent?.match(/\d+/)?.[0]) === revision + 1)
        }, beforeMove, { timeout: 12000 })
        await page.waitForFunction(() => {
          const previewSurface = document.querySelector('[data-preview-surface]')
          const feedbackFrame = document.querySelector('[data-move-feedback-frame]')
          return previewSurface?.getAttribute('data-preview-display-source') === 'viewport'
            && feedbackFrame?.style.transform === ''
        }, undefined, { timeout: 12000 })
        const pasteboardImage = editor.locator('[data-raster-pasteboard-layer] img')
        const documentBoundary = editor.locator('[data-document-boundary]')
        const [pasteboardImageBox, documentBoundaryBox] = await Promise.all([
          pasteboardImage.boundingBox(),
          documentBoundary.boundingBox(),
        ])
        if (!pasteboardImageBox || !documentBoundaryBox
          || pasteboardImageBox.y >= documentBoundaryBox.y - 100) {
          throw new Error('移出文档的原图没有继续显示在编辑工作区')
        }

        await editor.locator('[data-tool-id="annotation-rect"]').click()
        await page.mouse.move(startX - 120, startY - 80)
        await page.mouse.down()
        await page.mouse.move(startX + 80, startY + 70, { steps: 5 })
        await page.mouse.up()
        await editor.locator('[role="treeitem"][data-layer-type="annotation"]').waitFor({
          state: 'visible', timeout: 10000,
        })

        const addLayer = editor.getByRole('button', { name: /^(添加图层|Add layer)$/i })
        await addLayer.click()
        await page.getByRole('menuitem', { name: /^(高斯模糊|Gaussian Blur)$/i }).click()
        const blur = editor.locator('[role="treeitem"][data-layer-type="effect"]')
          .filter({ hasText: /^(高斯模糊|Gaussian Blur)$/i }).first()
        await blur.waitFor({ state: 'visible', timeout: 10000 })
        await editor.getByRole('button', { name: /^(下移图层|Move layer down)$/i }).click()
        await editor.getByRole('button', { name: /^(上移图层|Move layer up)$/i }).click()

        await page.waitForTimeout(700)
        await addLayer.click()
        await page.getByRole('menuitem', { name: /^(柔光 \/ 发光|Diffusion \/ Glow)$/i }).click()
        await editor.getByRole('slider', { name: /^(强度|Strength)$/i }).waitFor({
          state: 'visible', timeout: 10000,
        })
        await blur.locator('[data-layer-select]').click()
        const blurRadius = editor.getByRole('slider', { name: /^(半径|Radius)$/i })
        await blurRadius.focus()
        for (let index = 0; index < 100; index += 1) {
          await blurRadius.press(index % 2 === 0 ? 'ArrowRight' : 'ArrowLeft')
        }
        await settlePage(page, 2200)

        await editor.locator('[data-tool-id="crop"]').click()
        await editor.getByRole('button', { name: /^(向右旋转 90°|Rotate 90° right)$/i }).click()
        await editor.getByRole('button', { name: /^(应用裁剪|Apply crop)$/i }).click()
        await editor.getByRole('button', { name: /^(撤销|Undo)$/i }).click()
        await editor.getByRole('button', { name: /^(重做|Redo)$/i }).click()

        const formats = await editor.getByRole('button', {
          name: /^(选择栅格导出格式|Choose raster export format)$/i,
        }).click().then(() => page.locator('[data-export-format]').evaluateAll(
          (items) => items.map((item) => item.getAttribute('data-export-format')),
        ))
        if (formats.join(',') !== 'png8,jpeg,webp') {
          throw new Error(`发布候选导出格式不正确：${formats.join(',')}`)
        }
        await page.keyboard.press('Escape')

        const ingestedFormats = await page.evaluate(async () => {
          const canvas = document.createElement('canvas')
          canvas.width = 48
          canvas.height = 32
          const context = canvas.getContext('2d')
          if (!context) throw new Error('格式验收画布不可用')
          context.fillStyle = 'rgb(12, 140, 220)'
          context.fillRect(0, 0, canvas.width, canvas.height)
          const results = []
          for (const [index, mediaType] of ['image/png', 'image/webp'].entries()) {
            const dataUrl = canvas.toDataURL(mediaType, 0.9)
            const managed = await window.henjiNative.imageEditorV3.ingestSource({
              requestId: `reality-format-${index}-${crypto.randomUUID()}`,
              source: { kind: 'data-url', dataUrl },
            })
            results.push(managed.metadata.format)
          }
          return results
        })
        if (ingestedFormats[0] !== 'png' || ingestedFormats[1] !== 'webp') {
          throw new Error(`PNG/WebP 真实导入失败：${ingestedFormats.join(',')}`)
        }
        if (await editor.getByText(/重新载入编辑器|Reload editor/i).count()) {
          throw new Error('核心路径结束后图片编辑器进入了局部错误恢复状态')
        }
        const imageEditorWarnings = await page.evaluate(async (afterTimestamp) => {
          const result = await window.henjiNative.logging.queryLogEvents({
            date: new Date().toISOString().slice(0, 10),
            afterTimestamp,
            level: 'warn',
            limit: 200,
          })
          return result.events
            .filter((event) => event.domain.startsWith('image_editor_v3'))
            .map((event) => ({
              domain: event.domain,
              event: event.event,
              message: event.message,
              context: event.context,
            }))
        }, startedAt)
        if (imageEditorWarnings.length > 0) {
          throw new Error(`图片编辑核心路径出现警告：${JSON.stringify(imageEditorWarnings)}`)
        }
        await preview.getByRole('img').first().waitFor({ state: 'visible', timeout: 15000 })
        await preview.locator('.animate-spin').waitFor({ state: 'hidden', timeout: 15000 })
        await settlePage(page, 500)
      },
    },
    {
      id: 'toolbox-camera-stage',
      surface: '工具箱',
      name: '工具箱-3D 镜头工程',
      setup: async (page) => {
        await setupCameraStageProjectList(page)
        await settlePage(page, 700)
      },
    },
    {
      id: 'toolbox-camera-stage-lineart',
      surface: '工具箱',
      name: '工具箱-3D 镜头线稿成像',
      writesUserData: true,
      setup: setupCameraStageStyledEditor,
    },
  ]
}

module.exports = { createToolboxScenes }
