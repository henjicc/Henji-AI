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
      setup: async (page, electronApp) => {
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
            if (fixturePath) {
              if (!electronApp) throw new Error('本地图片基准验收缺少 Electron 主进程句柄')
              await electronApp.evaluate(({ dialog }, selectedPath) => {
                const key = '__henjiUiInspectionOriginalOpenDialog'
                if (globalThis[key]) throw new Error('UI 巡检文件对话框替身重复安装')
                globalThis[key] = dialog.showOpenDialog
                dialog.showOpenDialog = async () => ({
                  canceled: false,
                  filePaths: [selectedPath],
                })
              }, fixturePath)
              try {
                await surface.getByRole('button', {
                  name: /^(从文件打开|Open from file)$/i,
                }).click()
              } finally {
                await electronApp.evaluate(({ dialog }) => {
                  const key = '__henjiUiInspectionOriginalOpenDialog'
                  const original = globalThis[key]
                  if (typeof original === 'function') dialog.showOpenDialog = original
                  delete globalThis[key]
                })
              }
            } else {
              await dropTarget.evaluate(async (element) => {
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
              })
            }
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
          const parameterPanel = surface.locator('[data-properties-tab-panel="parameters"]')
          await parameterPanel.waitFor({ state: 'visible', timeout: 8000 })
          const glowControls = await parameterPanel.evaluate((panel) => ({
            sliders: [...panel.querySelectorAll('input[type="range"]')]
              .map((input) => input.getAttribute('aria-label')),
            scrollable: panel.scrollHeight > panel.clientHeight,
            repeatsLayerTitle: [...panel.querySelectorAll('*')]
              .some((element) => element.children.length === 0 && element.textContent?.trim() === '辉光 Pro'),
          }))
          for (const label of ['辉光强度', '半径', '色差', '亮源门槛', '核心白热']) {
            if (!glowControls.sliders.includes(label)) throw new Error(`辉光参数缺失：${label}`)
          }
          if (!glowControls.scrollable) throw new Error('辉光完整参数没有形成可滚动区域')
          if (glowControls.repeatsLayerTitle) throw new Error('参数 Tab 重复显示了图层名称')
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
        if (process.env.HENJI_VGPU_GLOW_FIXTURE_IMAGE) {
          const benchmarkStartedAt = new Date().toISOString()
          const surface = page.locator('[data-application-surface-id="tool.image_edit"]:visible')
          const preview = surface.locator('[data-preview-surface]')
          const presentation = surface.locator('[data-presentation-surface]')
          const frontSurface = presentation.locator('[data-presentation-front-surface]')
          const measureEffectFeedback = async (slider, label, from, to) => {
            const generationBeforeDrag = await frontSurface.getAttribute('data-render-generation')
            const sliderBox = await slider.boundingBox()
            if (!sliderBox) throw new Error(`test01 ${label}交互基准无法读取滑杆`)
            await page.mouse.move(
              sliderBox.x + sliderBox.width * from,
              sliderBox.y + sliderBox.height / 2,
            )
            await page.mouse.down()
            const feedbackStartedAt = Date.now()
            try {
              await page.mouse.move(
                sliderBox.x + sliderBox.width * to,
                sliderBox.y + sliderBox.height / 2,
                { steps: 24 },
              )
              await page.waitForFunction((previousGeneration) => {
                const front = document.querySelector('[data-presentation-front-surface]')
                return front?.getAttribute('data-render-generation') !== previousGeneration
              }, generationBeforeDrag, { timeout: 500 })
            } catch (error) {
              throw new Error(`test01 ${label}连续调参未在 500ms 内产出反馈帧：${error.message}`)
            } finally {
              await page.mouse.up()
            }
            const durationMs = Date.now() - feedbackStartedAt
            process.stdout.write(`  test01 ${label}连续调参反馈帧：${durationMs}ms\n`)
          }
          await measureEffectFeedback(radius, '辉光', 0.75, 0.3)
          await settlePage(page, 2500)

          const addLayer = surface.getByRole('button', { name: /^(添加图层|Add layer)$/i })
          await addLayer.click()
          await page.getByRole('menuitem', { name: /^(柔光 \/ 发光|Diffusion \/ Glow)$/i }).click()
          const diffusionStrength = surface.getByRole('slider', { name: /^(强度|Strength)$/i })
          await diffusionStrength.waitFor({ state: 'visible', timeout: 10000 })
          await settlePage(page, 2500)
          await measureEffectFeedback(diffusionStrength, '柔光/发光', 0.2, 0.75)

          await addLayer.click()
          await page.getByRole('menuitem', { name: /^(模糊|Blur)$/i }).click()
          const blurRadius = surface.getByRole('slider', { name: /^(半径|Radius)$/i })
          await blurRadius.waitFor({ state: 'visible', timeout: 10000 })
          await settlePage(page, 2500)
          const blurBox = await blurRadius.boundingBox()
          if (!blurBox) throw new Error('test01 模糊交互基准无法读取滑杆')
          await page.mouse.move(blurBox.x + blurBox.width * 0.05, blurBox.y + blurBox.height / 2)
          await page.mouse.down()
          const blurFeedbackStartedAt = Date.now()
          try {
            await page.mouse.move(
              blurBox.x + blurBox.width * 0.2,
              blurBox.y + blurBox.height / 2,
              { steps: 24 },
            )
            const liveBlur = surface.locator('[data-live-blur-feedback="active"]')
            await liveBlur.waitFor({ state: 'visible', timeout: 100 })
            const liveBlurClipState = await liveBlur.evaluate((element) => {
              const clip = element.closest('[data-document-clip]')
              return {
                insideDocumentClip: Boolean(clip),
                clipPath: clip instanceof HTMLElement ? getComputedStyle(clip).clipPath : 'none',
                filter: getComputedStyle(element).filter,
              }
            })
            if (!liveBlurClipState.insideDocumentClip
              || liveBlurClipState.clipPath === 'none'
              || liveBlurClipState.filter === 'none') {
              throw new Error(`test01 模糊即时反馈没有使用图片矩形裁切：${JSON.stringify(liveBlurClipState)}`)
            }
          } catch (error) {
            throw new Error(`test01 模糊实时反馈未在 500ms 内出现：${error.message}`)
          } finally {
            await page.mouse.up()
          }
          const blurFeedbackDurationMs = Date.now() - blurFeedbackStartedAt
          if (blurFeedbackDurationMs > 500) {
            throw new Error(`test01 模糊实时反馈超过 500ms：${blurFeedbackDurationMs}ms`)
          }
          process.stdout.write(`  test01 模糊连续调参反馈帧：${blurFeedbackDurationMs}ms\n`)
          await settlePage(page, 1200)
          const gpuState = await preview.evaluate((element) => {
            const front = element.querySelector('[data-presentation-front-surface]')
            const gpu = element.querySelector('[data-presentation-gpu-surface]')
            const clip = element.querySelector('[data-document-clip]')
            return {
              composition: element.getAttribute('data-preview-composition-backend'),
              effect: element.getAttribute('data-preview-effect-backend'),
              presentation: element.getAttribute('data-preview-presentation-backend'),
              device: element.getAttribute('data-preview-device-status'),
              readbackCount: Number(front?.getAttribute('data-gpu-readback-count') ?? '-1'),
              surfaceFrameCount: Number(front?.getAttribute('data-gpu-surface-frame-count') ?? '0'),
              imageBitmapFrameCount: Number(front?.getAttribute('data-gpu-image-bitmap-frame-count') ?? '-1'),
              directSurfaceFailureCount: Number(front?.getAttribute('data-gpu-direct-surface-failure-count') ?? '-1'),
              gpuVisibility: gpu instanceof HTMLElement ? getComputedStyle(gpu).visibility : null,
              renderGeneration: Number(front?.getAttribute('data-render-generation') ?? '0'),
              frontSize: front instanceof HTMLCanvasElement ? [front.width, front.height] : null,
              previewSize: [element.clientWidth, element.clientHeight],
              documentSize: clip instanceof HTMLElement ? [clip.clientWidth, clip.clientHeight] : null,
              devicePixelRatio: window.devicePixelRatio,
            }
          })
          if (gpuState.composition !== 'gpu' || gpuState.effect !== 'gpu'
            || gpuState.presentation !== 'webgpu-surface' || gpuState.device !== 'ready'
            || gpuState.readbackCount !== 0 || gpuState.renderGeneration <= 0
            || gpuState.surfaceFrameCount < 1 || gpuState.imageBitmapFrameCount !== 0
            || gpuState.directSurfaceFailureCount !== 0 || gpuState.gpuVisibility !== 'visible') {
            throw new Error(`test01 三效果未保持同一 GPU Surface：${JSON.stringify(gpuState)}`)
          }
          const runtimeEvidence = await page.evaluate(async (afterTimestamp) => {
            const result = await window.henjiNative.logging.queryLogEvents({
              date: new Date().toISOString().slice(0, 10),
              afterTimestamp,
              limit: 100,
            })
            return {
              errors: result.events.filter((event) => event.level === 'error'),
              budgetFallbacks: result.events.filter((event) => (
                event.event === 'image_editor_v3.gpu_scene.resource_budget_fallback'
              )),
            }
          }, benchmarkStartedAt)
          if (runtimeEvidence.errors.length > 0 || runtimeEvidence.budgetFallbacks.length !== 0) {
            throw new Error(`test01 效果GPU/超预算后备证据异常：${JSON.stringify(runtimeEvidence)}`)
          }
        }
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
        const editor = host.locator('[data-image-editor-v3]')
        await Promise.race([
          dropTarget.waitFor({ state: 'visible', timeout: 12000 }),
          editor.waitFor({ state: 'visible', timeout: 12000 }),
        ])
        const replacingExistingEditor = await editor.isVisible()
        const previousEditorElement = replacingExistingEditor ? await editor.elementHandle() : null
        const importTarget = replacingExistingEditor ? editor : dropTarget
        await importTarget.evaluate(async (element) => {
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

        if (previousEditorElement) {
          await page.waitForFunction(
            (element) => !element.isConnected,
            previousEditorElement,
            { timeout: 15000 },
          ).catch(() => {
            throw new Error('导入新图片后，旧编辑器实例在 15 秒内没有卸载')
          })
        }

        await editor.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {
          throw new Error('导入图片后，编辑器在 15 秒内没有进入可见状态')
        })
        const raster = editor.locator('[role="treeitem"][data-layer-type="raster"][aria-selected="true"]')
        await raster.waitFor({ state: 'visible', timeout: 12000 })
        const preview = editor.locator('[data-preview-surface]')
        await preview.waitFor({ state: 'visible', timeout: 12000 })
        await page.waitForFunction(() => (
          document.querySelector('[data-preview-surface]')?.getAttribute('data-move-availability') === 'ready'
        ), undefined, { timeout: 15000 }).catch(() => {
          throw new Error('图片编辑器打开后，移动能力在 15 秒内没有就绪')
        })
        await page.waitForFunction(() => (
          document.querySelector('[data-preview-surface]')?.getAttribute('data-preview-display-source') === 'viewport'
            && (() => {
              const frame = document.querySelector('[data-raster-display-frame]')
              const source = document.querySelector('[data-raster-pasteboard-layer]')
              return frame instanceof HTMLElement
                && source?.getAttribute('data-raster-source-ready') === 'true'
                && frame.querySelector('[data-presentation-front-surface]') instanceof HTMLCanvasElement
                && frame.querySelector('[data-presentation-safety-surface]') instanceof HTMLCanvasElement
            })()
        ), undefined, { timeout: 15000 }).catch(async () => {
          const state = await editor.evaluate((root) => ({
            displaySource: root.querySelector('[data-preview-surface]')?.getAttribute('data-preview-display-source') ?? null,
            hasDisplayFrame: Boolean(root.querySelector('[data-raster-display-frame]')),
            presentationSurfaceCount: root.querySelectorAll('[data-presentation-surface]').length,
            frontSurfaceCount: root.querySelectorAll('[data-presentation-front-surface]').length,
            safetySurfaceCount: root.querySelectorAll('[data-presentation-safety-surface]').length,
          }))
          throw new Error(`图片编辑器打开后，常驻显示表面在 15 秒内没有就绪：${JSON.stringify(state)}`)
        })

        const displayFrame = editor.locator('[data-raster-display-frame]')
        const rasterSource = editor.locator('[data-raster-pasteboard-layer]')
        const documentClip = editor.locator('[data-document-clip]')
        const transparencyGrid = editor.locator('[data-document-transparency-grid]')
        if (await rasterSource.count() !== 1
          || await displayFrame.count() !== 1
          || await documentClip.count() !== 1
          || await transparencyGrid.count() !== 1
          || await editor.locator('[data-document-boundary]').count() !== 0) {
          throw new Error('原图没有收口到唯一图片裁切层与透明底层')
        }
        const initialDocumentSurface = await editor.evaluate(() => {
          const clip = document.querySelector('[data-document-clip]')
          const frame = document.querySelector('[data-raster-display-frame]')
          const source = document.querySelector('[data-raster-pasteboard-layer]')
          const grid = document.querySelector('[data-document-transparency-grid]')
          return {
            frameInsideClip: Boolean(clip && frame && clip.contains(frame)),
            sourceInsideClip: Boolean(clip && source && clip.contains(source)),
            sourceReady: source?.getAttribute('data-raster-source-ready') ?? null,
            cachedFrameVisibility: frame instanceof HTMLElement
              ? getComputedStyle(frame).visibility
              : null,
            clipPath: clip instanceof HTMLElement ? getComputedStyle(clip).clipPath : 'none',
            gridBackground: grid instanceof HTMLElement ? getComputedStyle(grid).backgroundImage : 'none',
          }
        })
        if (!initialDocumentSurface.frameInsideClip
          || !initialDocumentSurface.sourceInsideClip
          || initialDocumentSurface.sourceReady !== 'true'
          || initialDocumentSurface.cachedFrameVisibility !== 'hidden'
          || initialDocumentSurface.clipPath === 'none'
          || !initialDocumentSurface.gridBackground.includes('conic-gradient')) {
          throw new Error(`图片裁切层或透明网格没有生效：${JSON.stringify(initialDocumentSurface)}`)
        }
        const waitForVisibleRasterPixels = async (stage) => {
          await page.waitForFunction(() => {
            const frame = document.querySelector('[data-raster-display-frame]')
            const canvases = frame ? [...frame.querySelectorAll('canvas')] : []
            return canvases.some((canvas) => {
              if (!(canvas instanceof HTMLCanvasElement) || canvas.width < 1 || canvas.height < 1) {
                return false
              }
              const sample = document.createElement('canvas')
              sample.width = 24
              sample.height = 24
              const context = sample.getContext('2d', { willReadFrequently: true })
              if (!context) return false
              context.drawImage(canvas, 0, 0, sample.width, sample.height)
              const pixels = context.getImageData(0, 0, sample.width, sample.height).data
              for (let offset = 0; offset < pixels.length; offset += 4) {
                if (pixels[offset + 3] > 16
                  && Math.max(pixels[offset], pixels[offset + 1], pixels[offset + 2]) > 16) {
                  return true
                }
              }
              return false
            })
          }, undefined, { timeout: 5000 }).catch(() => {
            return displayFrame.evaluate((frame) => {
              const presentation = frame.querySelector('[data-presentation-surface]')
              const canvases = [...frame.querySelectorAll('canvas')]
              let maxAlpha = 0
              let maxSignal = 0
              for (const canvas of canvases) {
                if (!(canvas instanceof HTMLCanvasElement) || canvas.width < 1 || canvas.height < 1) {
                  continue
                }
                const sample = document.createElement('canvas')
                sample.width = 24
                sample.height = 24
                const context = sample.getContext('2d', { willReadFrequently: true })
                if (!context) continue
                context.drawImage(canvas, 0, 0, sample.width, sample.height)
                const pixels = context.getImageData(0, 0, sample.width, sample.height).data
                for (let offset = 0; offset < pixels.length; offset += 4) {
                  maxAlpha = Math.max(maxAlpha, pixels[offset + 3])
                  maxSignal = Math.max(
                    maxSignal,
                    pixels[offset],
                    pixels[offset + 1],
                    pixels[offset + 2],
                  )
                }
              }
              return {
                surfaceId: presentation?.getAttribute('data-presentation-surface') ?? null,
                canvasCount: canvases.length,
                maxAlpha,
                maxSignal,
              }
            }).then((diagnostics) => {
              throw new Error(
                `${stage}后图片预览未产出有效画面：${JSON.stringify(diagnostics)}`,
              )
            })
          })
        }
        await waitForVisibleRasterPixels('打开原图')

        const defaultMoveTool = editor.locator('[data-tool-id="move"]')
        if (await defaultMoveTool.getAttribute('aria-pressed') !== 'true') {
          throw new Error('图片编辑器默认工具不是移动工具')
        }
        const snappingSwitch = editor.getByRole('switch', { name: /^(吸附|Snap)$/i })
        await snappingSwitch.waitFor({ state: 'visible', timeout: 3000 })
        if (await snappingSwitch.getAttribute('aria-checked') !== 'true') {
          throw new Error('移动工具没有默认开启吸附')
        }

        const layerAddTrigger = editor.getByRole('button', { name: /^(添加图层|Add layer)$/i })
        await layerAddTrigger.click()
        const layerAddMenu = page.locator('[data-layer-add-menu]')
        await layerAddMenu.waitFor({ state: 'visible', timeout: 3000 })
        const layerMenuLayout = await layerAddMenu.evaluate((menu) => {
          const panel = menu.parentElement?.parentElement
          const items = [...menu.querySelectorAll('[role="menuitem"]')]
          return {
            panelWidth: panel?.getBoundingClientRect().width ?? 0,
            maxLabelWidth: Math.max(0, ...items.map((item) => (
              item.querySelector('span')?.getBoundingClientRect().width ?? 0
            ))),
            items: items.map((item) => {
              const style = getComputedStyle(item)
              return { textAlign: style.textAlign }
            }),
          }
        })
        const layerMenuHorizontalSpace = layerMenuLayout.panelWidth - layerMenuLayout.maxLabelWidth
        if (layerMenuLayout.panelWidth < 72
          || layerMenuLayout.panelWidth > 128
          || layerMenuHorizontalSpace < 16
          || layerMenuHorizontalSpace > 40
          || layerMenuLayout.items.length === 0
          || layerMenuLayout.items.some(({ textAlign }) => textAlign !== 'left')) {
          throw new Error(`图层添加菜单没有收窄并左对齐：${JSON.stringify(layerMenuLayout)}`)
        }
        await page.keyboard.press('Escape')
        await layerAddMenu.waitFor({ state: 'hidden', timeout: 1000 })

        const rightDock = editor.locator('[data-editor-panel-dock="right"]')
        const dockedPanels = rightDock.locator('[data-docked-editor-panel]')
        if (await dockedPanels.count() !== 2) {
          throw new Error('图层与属性没有在右侧停靠区上下组合')
        }
        const initialDockOrder = await dockedPanels.evaluateAll((panels) => (
          panels.map((panel) => panel.getAttribute('data-editor-panel-id'))
        ))
        if (initialDockOrder.join(',') !== 'layers,properties') {
          throw new Error(`右侧停靠顺序错误：${initialDockOrder.join(',')}`)
        }
        const parametersTab = editor.getByRole('tab', { name: /^(参数|Parameters)$/i })
        const basicsTab = editor.getByRole('tab', { name: /^(基础|Basics)$/i })
        if (await parametersTab.getAttribute('aria-selected') !== 'true') {
          throw new Error('新选择图层后没有默认打开参数 Tab')
        }
        await basicsTab.click()
        await editor.getByRole('textbox', { name: /^(名称|Name)$/i }).waitFor({ state: 'visible' })
        await parametersTab.click()

        const dockWidthSeparator = rightDock.locator('[data-panel-resize-axis="horizontal"]')
        const [dockBeforeResize, dockWidthHandleBox] = await Promise.all([
          rightDock.boundingBox(),
          dockWidthSeparator.boundingBox(),
        ])
        if (!dockBeforeResize || !dockWidthHandleBox) throw new Error('无法读取面板宽度拖动边缘')
        await page.mouse.move(
          dockWidthHandleBox.x + dockWidthHandleBox.width / 2,
          dockWidthHandleBox.y + dockWidthHandleBox.height / 2,
        )
        await page.mouse.down()
        await page.mouse.move(dockWidthHandleBox.x - 48, dockWidthHandleBox.y + 40, { steps: 5 })
        await page.mouse.up()
        const dockAfterResize = await rightDock.boundingBox()
        if (!dockAfterResize || dockAfterResize.width < dockBeforeResize.width + 40) {
          throw new Error('拖动右侧面板内边缘没有调整面板宽度')
        }

        const dockSplitSeparator = rightDock.locator('[data-panel-resize-axis="vertical"]')
        const [layerPanelBeforeSplit, splitHandleBox] = await Promise.all([
          rightDock.locator('[data-editor-panel-id="layers"]').boundingBox(),
          dockSplitSeparator.boundingBox(),
        ])
        if (!layerPanelBeforeSplit || !splitHandleBox) throw new Error('无法读取面板上下分隔条')
        await page.mouse.move(splitHandleBox.x + splitHandleBox.width / 2, splitHandleBox.y + 4)
        await page.mouse.down()
        await page.mouse.move(splitHandleBox.x + splitHandleBox.width / 2, splitHandleBox.y + 64, { steps: 5 })
        await page.mouse.up()
        const layerPanelAfterSplit = await rightDock.locator('[data-editor-panel-id="layers"]').boundingBox()
        if (!layerPanelAfterSplit || layerPanelAfterSplit.height < layerPanelBeforeSplit.height + 48) {
          throw new Error('拖动上下分隔条没有调整图层与属性面板高度')
        }
        const propertiesPanel = editor.locator('[data-editor-panel-id="properties"]')
        let propertiesHandle = propertiesPanel.locator('[data-editor-panel-handle]')
        const [panelBefore, handleBox] = await Promise.all([
          propertiesPanel.boundingBox(),
          propertiesHandle.boundingBox(),
        ])
        if (!panelBefore || !handleBox) throw new Error('无法读取停靠属性面板位置')
        await page.mouse.move(handleBox.x + 30, handleBox.y + handleBox.height / 2)
        await page.mouse.down()
        await page.mouse.move(
          handleBox.x - 240,
          handleBox.y + handleBox.height / 2 - 80,
          { steps: 5 },
        )
        await page.mouse.up()
        await propertiesPanel.evaluate((panel) => {
          if (panel.getAttribute('data-panel-mode') !== 'floating') {
            throw new Error('属性面板拖离停靠区后没有切换为浮窗')
          }
          if (!panel.classList.contains('ui-glass')) {
            throw new Error('浮动属性面板没有使用画布玻璃表面')
          }
        })
        const panelAfter = await propertiesPanel.boundingBox()
        if (!panelAfter
          || panelAfter.x >= panelBefore.x - 120
          || panelAfter.y >= panelBefore.y - 30) {
          throw new Error('属性面板没有从停靠区跟随标题栏拖出')
        }

        const workspaceBox = await editor.locator('[data-editor-panel-workspace]').boundingBox()
        propertiesHandle = propertiesPanel.locator('[data-editor-panel-handle]')
        const floatingHandleBox = await propertiesHandle.boundingBox()
        if (!workspaceBox || !floatingHandleBox) throw new Error('无法读取面板重新停靠范围')
        await page.mouse.move(
          floatingHandleBox.x + 30,
          floatingHandleBox.y + floatingHandleBox.height / 2,
        )
        await page.mouse.down()
        await page.mouse.move(
          workspaceBox.x + workspaceBox.width - 8,
          workspaceBox.y + workspaceBox.height - 48,
          { steps: 8 },
        )
        await editor.locator('[data-editor-panel-dock-preview="right"]')
          .waitFor({ state: 'visible', timeout: 3000 })
        await page.mouse.up()
        await propertiesPanel.evaluate((panel) => {
          if (panel.getAttribute('data-panel-mode') !== 'docked'
            || panel.getAttribute('data-panel-dock-edge') !== 'right') {
            throw new Error('属性面板拖到右边缘后没有自动吸附')
          }
        })
        const recombinedOrder = await rightDock.locator('[data-docked-editor-panel]').evaluateAll((panels) => (
          panels.map((panel) => panel.getAttribute('data-editor-panel-id'))
        ))
        if (recombinedOrder.join(',') !== 'layers,properties') {
          throw new Error(`属性面板没有组合到图层面板下方：${recombinedOrder.join(',')}`)
        }

        const annotationTool = editor.locator('[data-tool-id="annotation"]')
        const annotationToolBox = await annotationTool.boundingBox()
        if (!annotationToolBox) throw new Error('无法读取标注工具位置')
        await annotationTool.hover()
        const annotationTooltip = page.getByRole('tooltip', { name: /^(标注工具|Annotation tools)$/i })
        await annotationTooltip.waitFor({ state: 'visible', timeout: 3000 })
        const annotationTooltipBox = await annotationTooltip.boundingBox()
        if (!annotationTooltipBox
          || Math.abs(annotationTooltipBox.x - (annotationToolBox.x + annotationToolBox.width / 2 + 8)) > 5
          || Math.abs(annotationTooltipBox.y - (annotationToolBox.y + annotationToolBox.height / 2 + 8)) > 5) {
          throw new Error('工具提示没有以鼠标位置为左上角对齐')
        }

        const readRevision = async () => {
          const revision = Number(await editor.locator('[data-command-bar]')
            .getAttribute('data-document-revision'))
          if (!Number.isSafeInteger(revision)) throw new Error('无法读取图片编辑 revision')
          return revision
        }
        const zoomStartedAt = new Date().toISOString()
        const presentationSurface = editor.locator('[data-presentation-surface]')
        const persistentPresentation = await presentationSurface.elementHandle()
        if (!persistentPresentation) throw new Error('连续缩放前无法取得常驻显示表面')
        const zoomIdentityBefore = await presentationSurface.evaluate((surface) => {
          const front = surface.querySelector('[data-presentation-front-surface]')
          return {
            surfaceId: surface.getAttribute('data-presentation-surface'),
            renderGeneration: front?.getAttribute('data-render-generation'),
            cameraSequence: Number(front?.getAttribute('data-camera-sequence')),
          }
        })
        await editor.locator('[data-tool-id="zoom"]').click()
        const zoomPreviewBox = await preview.boundingBox()
        if (!zoomPreviewBox) throw new Error('连续缩放前无法读取图片编辑预览范围')
        const startX = zoomPreviewBox.x + zoomPreviewBox.width * 0.5
        const startY = zoomPreviewBox.y + zoomPreviewBox.height * 0.5
        await page.mouse.move(
          zoomPreviewBox.x + zoomPreviewBox.width * 0.5,
          zoomPreviewBox.y + zoomPreviewBox.height * 0.5,
        )
        for (let index = 0; index < 40; index += 1) {
          await page.mouse.wheel(0, index % 2 === 0 ? -1 : 1)
          await page.waitForTimeout(5)
        }
        await settlePage(page, 400)
        const zoomIdentityAfter = await presentationSurface.evaluate((surface, previous) => {
          const front = surface.querySelector('[data-presentation-front-surface]')
          const previewSurface = surface.closest('[data-preview-surface]')
          return {
            sameSurface: surface === previous,
            surfaceId: surface.getAttribute('data-presentation-surface'),
            renderGeneration: front?.getAttribute('data-render-generation'),
            cameraSequence: Number(front?.getAttribute('data-camera-sequence')),
            coverage: Number(previewSurface?.getAttribute('data-preview-coverage')),
          }
        }, persistentPresentation)
        if (!zoomIdentityAfter.sameSurface
          || zoomIdentityAfter.surfaceId !== zoomIdentityBefore.surfaceId
          || zoomIdentityAfter.renderGeneration !== zoomIdentityBefore.renderGeneration
          || !(zoomIdentityAfter.cameraSequence > zoomIdentityBefore.cameraSequence)
          || zoomIdentityAfter.coverage !== 1) {
          throw new Error(`连续缩放破坏了常驻显示表面或像素 generation：${JSON.stringify({
            before: zoomIdentityBefore,
            after: zoomIdentityAfter,
          })}`)
        }
        const legacyPreviewStarts = await page.evaluate(async (afterTimestamp) => {
          const result = await window.henjiNative.logging.queryLogEvents({
            date: new Date().toISOString().slice(0, 10),
            afterTimestamp,
            level: 'debug',
            limit: 200,
          })
          return result.events.filter((event) => (
            event.event === 'image_editor_v3.preview.started'
          )).length
        }, zoomStartedAt)
        if (legacyPreviewStarts !== 0) {
          throw new Error(`连续缩放错误启动了 ${legacyPreviewStarts} 个旧式整图预览任务`)
        }

        const readZoomPercent = async () => Number((
          await editor.locator('[data-viewport-control] span').textContent()
        )?.match(/\d+/)?.[0])
        const beforeDragZoom = await readZoomPercent()
        await page.mouse.move(
          zoomPreviewBox.x + zoomPreviewBox.width * 0.45,
          zoomPreviewBox.y + zoomPreviewBox.height * 0.55,
        )
        await page.mouse.down()
        await page.mouse.move(
          zoomPreviewBox.x + zoomPreviewBox.width * 0.62,
          zoomPreviewBox.y + zoomPreviewBox.height * 0.55,
          { steps: 8 },
        )
        await page.mouse.up()
        const afterDragZoom = await readZoomPercent()
        if (!(afterDragZoom > beforeDragZoom)) {
          throw new Error('缩放工具向右拖动没有放大画布')
        }

        await page.mouse.click(startX, startY)
        await page.waitForFunction(() => {
          const label = document.querySelector('[data-viewport-control] span')?.textContent ?? ''
          return Number(label.match(/\d+/)?.[0]) === 100
        }, undefined, { timeout: 1000 }).catch(() => {
          throw new Error('缩放工具单击没有恢复为适应窗口的 100% 状态')
        })

        const beforePanRevision = await readRevision()
        await defaultMoveTool.click()
        await page.keyboard.down('Space')
        await page.waitForFunction(() => (
          document.querySelector('[data-preview-surface]')?.getAttribute('data-temporary-hand') === 'active'
        ), undefined, { timeout: 1000 }).catch(() => {
          throw new Error('按住空格后没有进入临时抓手状态')
        })
        const beforePanBox = await editor.locator('[data-viewport-content]').boundingBox()
        if (!beforePanBox) throw new Error('抓手移动前无法读取画布位置')
        await page.mouse.move(startX, startY)
        await page.mouse.down()
        await page.mouse.move(startX + 34, startY + 28, { steps: 5 })
        await page.mouse.up()
        await page.keyboard.up('Space')
        const afterPanBox = await editor.locator('[data-viewport-content]').boundingBox()
        const afterPanRevision = await readRevision()
        if (!afterPanBox
          || Math.abs(afterPanBox.x - beforePanBox.x - 34) > 2
          || Math.abs(afterPanBox.y - beforePanBox.y - 28) > 2
          || afterPanRevision !== beforePanRevision
          || await defaultMoveTool.getAttribute('aria-pressed') !== 'true'
          || await preview.getAttribute('data-temporary-hand') !== null) {
          throw new Error('空格临时抓手没有独立移动工作区，或错误切换了默认工具')
        }
        await page.waitForFunction(() => (
          document.querySelector('[data-preview-surface]')?.getAttribute('data-move-availability') === 'ready'
        ), undefined, { timeout: 10000 }).catch(() => {
          throw new Error('切回移动工具后，图层移动能力没有恢复为可用')
        })

        const beforeMove = await readRevision()
        const feedback = editor.locator('[data-move-feedback-frame]')
        const viewportContent = editor.locator('[data-viewport-content]')
        const initialFeedbackBox = await feedback.boundingBox()
        const initialViewportContentBox = await viewportContent.boundingBox()
        const initialTransparencyBox = await transparencyGrid.boundingBox()
        const initialDocumentClipPath = await documentClip.evaluate((element) => (
          getComputedStyle(element).clipPath
        ))
        if (!initialFeedbackBox || !initialViewportContentBox || !initialTransparencyBox) {
          throw new Error('移动 JPG 前无法读取稳定画面边界')
        }
        const beforeSnap = await readRevision()
        await page.mouse.move(startX, startY)
        await page.mouse.down()
        await page.mouse.move(startX + 6, startY, { steps: 3 })
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())))
        const snapFeedback = await feedback.evaluate((element) => element.style.transform)
        const snapGuides = await editor.evaluate(() => ([...document.querySelectorAll('[data-snap-guide-axis]')]
          .map((element) => {
            const rect = element.getBoundingClientRect()
            return {
              axis: element.getAttribute('data-snap-guide-axis'),
              visibility: getComputedStyle(element).visibility,
              width: rect.width,
              height: rect.height,
            }
          })))
        if (snapFeedback !== ''
          || snapGuides.length !== 2
          || snapGuides.some(({ visibility, width, height }) => (
            visibility !== 'visible' || width <= 0 || height <= 0
          ))) {
          throw new Error(`图片靠近原位时没有吸附并显示中心参考线：${JSON.stringify({
            snapFeedback,
            snapGuides,
          })}`)
        }
        await page.mouse.up()
        if (await readRevision() !== beforeSnap) {
          throw new Error('吸附回原位仍错误产生了编辑记录')
        }
        const hiddenSnapGuides = await editor.locator('[data-snap-guide-axis]').evaluateAll((guides) => (
          guides.every((guide) => getComputedStyle(guide).visibility === 'hidden')
        ))
        if (!hiddenSnapGuides) throw new Error('移动结束后吸附参考线没有隐藏')

        await page.mouse.move(startX, startY)
        await page.keyboard.down('Control')
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
          const [
            source,
            currentFeedbackBox,
            currentViewportContentBox,
            currentTransparencyBox,
            currentDocumentClipPath,
            revision,
          ] = await Promise.all([
            preview.getAttribute('data-preview-display-source'),
            feedback.boundingBox(),
            viewportContent.boundingBox(),
            transparencyGrid.boundingBox(),
            documentClip.evaluate((element) => getComputedStyle(element).clipPath),
            readRevision(),
          ])
          if (source !== 'viewport') throw new Error('移动 JPG 期间稳定分块画面被草稿替换')
          if (revision !== beforeMove) throw new Error('移动 JPG 期间提前提交了文档 revision')
          if (!currentFeedbackBox || !currentViewportContentBox) throw new Error('移动 JPG 期间画面边界丢失')
          if (Math.abs(currentFeedbackBox.x - initialFeedbackBox.x - expectedX) > 1.5
            || Math.abs(currentFeedbackBox.y - initialFeedbackBox.y - expectedY) > 1.5) {
            throw new Error('移动 JPG 的实际画面位置没有跟随指针')
          }
          if (Math.abs(currentViewportContentBox.x - initialViewportContentBox.x) > 0.5
            || Math.abs(currentViewportContentBox.y - initialViewportContentBox.y) > 0.5
            || Math.abs(currentViewportContentBox.width - initialViewportContentBox.width) > 0.5
            || Math.abs(currentViewportContentBox.height - initialViewportContentBox.height) > 0.5) {
            throw new Error('移动 JPG 期间工作区参考范围跟随内容发生了偏移')
          }
          if (!currentTransparencyBox
            || Math.abs(currentTransparencyBox.x - initialTransparencyBox.x) > 0.5
            || Math.abs(currentTransparencyBox.y - initialTransparencyBox.y) > 0.5
            || currentDocumentClipPath !== initialDocumentClipPath) {
            throw new Error('移动 JPG 期间图片边界或透明底层错误跟随图层移动')
          }
        }
        const transientTransform = await feedback.evaluate(
          (element) => element.style.transform,
        )
        if (!transientTransform.includes('translate')) {
          throw new Error('移动 JPG 时没有即时位移反馈')
        }
        await page.mouse.up()
        await page.keyboard.up('Control')
        await page.waitForFunction((revision) => {
          return Number(document.querySelector('[data-command-bar]')
            ?.getAttribute('data-document-revision')) === revision + 1
        }, beforeMove, { timeout: 12000 })
        await page.waitForFunction(() => {
          const previewSurface = document.querySelector('[data-preview-surface]')
          const feedbackFrame = document.querySelector('[data-move-feedback-frame]')
          return previewSurface?.getAttribute('data-preview-display-source') === 'viewport'
            && feedbackFrame?.style.transform === ''
        }, undefined, { timeout: 12000 })

        const beforeReverseMove = await readRevision()
        const [movedImageBox, currentDocumentBox] = await Promise.all([
          feedback.locator('img').boundingBox(),
          viewportContent.boundingBox(),
        ])
        if (!movedImageBox || !currentDocumentBox) {
          throw new Error('反向拖回前无法读取图片与图片区域的可见交集')
        }
        const visibleLeft = Math.max(movedImageBox.x, currentDocumentBox.x)
        const visibleTop = Math.max(movedImageBox.y, currentDocumentBox.y)
        const visibleRight = Math.min(
          movedImageBox.x + movedImageBox.width,
          currentDocumentBox.x + currentDocumentBox.width,
        )
        const visibleBottom = Math.min(
          movedImageBox.y + movedImageBox.height,
          currentDocumentBox.y + currentDocumentBox.height,
        )
        if (visibleRight <= visibleLeft || visibleBottom <= visibleTop) {
          throw new Error('第一次移动后图片在图片区域内没有可拖动部分')
        }
        const reverseStartX = (visibleLeft + visibleRight) / 2
        const reverseStartY = (visibleTop + visibleBottom) / 2
        await page.mouse.move(reverseStartX, reverseStartY)
        await page.mouse.down()
        await page.mouse.move(reverseStartX - 30, reverseStartY, { steps: 6 })
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())))
        const reverseTransform = await feedback.evaluate((element) => element.style.transform)
        if (!reverseTransform.includes('-30px')) {
          throw new Error(`反向拖回时完整源图没有跟随指针：${reverseTransform}`)
        }
        const duringReverse = await documentClip.screenshot({ animations: 'disabled' })
        const [clipBox, documentBox] = await Promise.all([
          documentClip.boundingBox(),
          transparencyGrid.boundingBox(),
        ])
        if (!clipBox || !documentBox) throw new Error('反向拖回时无法读取图片右边缘')
        await page.mouse.up()
        await page.waitForFunction((revision) => {
          const feedbackFrame = document.querySelector('[data-move-feedback-frame]')
          return Number(document.querySelector('[data-command-bar]')
            ?.getAttribute('data-document-revision')) === revision + 1
            && feedbackFrame?.style.transform === ''
        }, beforeReverseMove, { timeout: 12000 })
        const afterReverse = await documentClip.screenshot({ animations: 'disabled' })
        await settlePage(page, 700)
        const settledReverse = await documentClip.screenshot({ animations: 'disabled' })
        const [sharpModule, visualDiffModule] = await Promise.all([
          import('sharp'),
          import('./canvasVisualDiff.cjs'),
        ])
        const sharp = sharpModule.default
        const diffBuffers = visualDiffModule.diffBuffers
          ?? visualDiffModule.default?.diffBuffers
        if (typeof diffBuffers !== 'function') throw new Error('无法加载真实界面像素对比工具')
        const metadata = await sharp(duringReverse).metadata()
        const scaleX = Number(metadata.width) / clipBox.width
        const scaleY = Number(metadata.height) / clipBox.height
        const rightEdgeRect = {
          left: (documentBox.x - clipBox.x + Math.max(0, documentBox.width - 80)) * scaleX,
          top: (documentBox.y - clipBox.y) * scaleY,
          width: Math.min(80, documentBox.width) * scaleX,
          height: documentBox.height * scaleY,
        }
        const [dragToCommitDiff, commitToSettledDiff] = await Promise.all([
          diffBuffers(duringReverse, afterReverse, rightEdgeRect),
          diffBuffers(afterReverse, settledReverse, rightEdgeRect),
        ])
        if (dragToCommitDiff.changedPct > 2 || commitToSettledDiff.changedPct > 2) {
          throw new Error(`反向拖回右侧内容在松手后才补齐：${JSON.stringify({
            dragToCommitDiff,
            commitToSettledDiff,
          })}`)
        }
        const clippingState = await displayFrame.evaluate((frame) => {
          const frameRect = frame.getBoundingClientRect()
          const documentFrame = document.querySelector('[data-viewport-content]')
          const documentRect = documentFrame?.getBoundingClientRect()
          const presentation = frame.querySelector('[data-presentation-surface]')
          const presentationRect = presentation?.getBoundingClientRect()
          const canvases = [...frame.querySelectorAll('canvas')]
          let outsideSamples = 0
          let maxOutsideAlpha = 0
          if (documentRect) {
            for (const canvas of canvases) {
              if (!(canvas instanceof HTMLCanvasElement) || canvas.width < 1 || canvas.height < 1) continue
              const context = canvas.getContext('2d', { willReadFrequently: true })
              if (!context) continue
              for (let row = 0; row < 12; row += 1) {
                for (let column = 0; column < 18; column += 1) {
                  const clientX = frameRect.left + (column + 0.5) / 18 * frameRect.width
                  const clientY = frameRect.top + (row + 0.5) / 12 * frameRect.height
                  const outsideDocument = clientX < documentRect.left
                    || clientX > documentRect.right
                    || clientY < documentRect.top
                    || clientY > documentRect.bottom
                  if (!outsideDocument) continue
                  outsideSamples += 1
                  const pixelX = Math.min(canvas.width - 1, Math.max(0, Math.floor(
                    (clientX - frameRect.left) / frameRect.width * canvas.width,
                  )))
                  const pixelY = Math.min(canvas.height - 1, Math.max(0, Math.floor(
                    (clientY - frameRect.top) / frameRect.height * canvas.height,
                  )))
                  maxOutsideAlpha = Math.max(
                    maxOutsideAlpha,
                    context.getImageData(pixelX, pixelY, 1, 1).data[3],
                  )
                }
              }
            }
          }
          return {
            overflow: getComputedStyle(frame).overflow,
            canvasCount: canvases.length,
            hasSinglePresentation: frame.querySelectorAll('[data-presentation-surface]').length === 1,
            surfaceMatchesFrame: Boolean(presentationRect)
              && Math.abs(presentationRect.left - frameRect.left) <= 0.5
              && Math.abs(presentationRect.top - frameRect.top) <= 0.5
              && Math.abs(presentationRect.width - frameRect.width) <= 0.5
              && Math.abs(presentationRect.height - frameRect.height) <= 0.5,
            outsideSamples,
            maxOutsideAlpha,
          }
        })
        if (clippingState.overflow !== 'hidden'
          || clippingState.canvasCount !== 2
          || !clippingState.hasSinglePresentation
          || !clippingState.surfaceMatchesFrame
          || (clippingState.outsideSamples > 0 && clippingState.maxOutsideAlpha !== 0)) {
          throw new Error(`移动后的常驻表面没有严格裁切：${JSON.stringify(clippingState)}`)
        }

        const annotationStartedAt = new Date().toISOString()
        const beforeFirstAnnotation = await readRevision()
        await annotationTool.click()
        const commandBarStructure = await editor.locator('[data-command-bar]').evaluate((commandBar) => {
          const parameters = commandBar.querySelector('[data-tool-parameters]')
          const toolGroup = commandBar.querySelector('[role="group"][aria-label="标注类型"], [role="group"][aria-label="Annotation type"]')
          return {
            commandBarCount: document.querySelectorAll('[data-command-bar]').length,
            contextBarCount: document.querySelectorAll('[data-context-bar]').length,
            parametersInside: Boolean(parameters),
            annotationToolCount: toolGroup?.querySelectorAll('[data-annotation-tool-id]').length ?? 0,
            annotationToolText: toolGroup?.textContent?.trim() ?? '',
          }
        })
        if (commandBarStructure.commandBarCount !== 1
          || commandBarStructure.contextBarCount !== 0
          || !commandBarStructure.parametersInside
          || commandBarStructure.annotationToolCount !== 8
          || commandBarStructure.annotationToolText !== '') {
          throw new Error(`标注参数没有正确收进单行命令带：${JSON.stringify(commandBarStructure)}`)
        }
        await editor.getByRole('button', { name: /^(矩形标注|Rectangle annotation)$/i }).click()
        const annotationOverlay = editor.locator('[data-annotation-editor-overlay]')
        await annotationOverlay.waitFor({ state: 'visible', timeout: 5000 })
        const [annotationBox, currentPreviewBox] = await Promise.all([
          annotationOverlay.boundingBox(),
          preview.boundingBox(),
        ])
        if (!annotationBox || !currentPreviewBox) throw new Error('无法读取标注画布范围')
        const visibleAnnotationBox = {
          x: Math.max(annotationBox.x, currentPreviewBox.x),
          y: Math.max(annotationBox.y, currentPreviewBox.y),
          width: Math.min(
            annotationBox.x + annotationBox.width,
            currentPreviewBox.x + currentPreviewBox.width,
          ) - Math.max(annotationBox.x, currentPreviewBox.x),
          height: Math.min(
            annotationBox.y + annotationBox.height,
            currentPreviewBox.y + currentPreviewBox.height,
          ) - Math.max(annotationBox.y, currentPreviewBox.y),
        }
        if (visibleAnnotationBox.width < 120 || visibleAnnotationBox.height < 120) {
          throw new Error(`标注画布可见范围过小：${JSON.stringify(visibleAnnotationBox)}`)
        }
        const annotationStartX = visibleAnnotationBox.x + visibleAnnotationBox.width * 0.22
        const annotationStartY = visibleAnnotationBox.y + visibleAnnotationBox.height * 0.28
        const annotationEndX = visibleAnnotationBox.x + visibleAnnotationBox.width * 0.54
        const annotationEndY = visibleAnnotationBox.y + visibleAnnotationBox.height * 0.58
        await page.mouse.move(annotationStartX, annotationStartY)
        await page.mouse.down()
        await page.mouse.move(annotationEndX, annotationEndY, { steps: 5 })
        if (await annotationOverlay.getAttribute('data-annotation-drawing') !== 'true') {
          const canvasBox = await annotationOverlay.locator('canvas').first().boundingBox()
          throw new Error(`标注画布没有接住首笔手势：overlay=${JSON.stringify(annotationBox)}, canvas=${JSON.stringify(canvasBox)}`)
        }
        await page.mouse.up()
        await editor.locator('[role="treeitem"][data-layer-type="annotation"]').waitFor({
          state: 'visible', timeout: 10000,
        })
        await editor.locator('[data-annotation-editor-overlay][data-live-annotation-layer-count="1"]')
          .waitFor({ state: 'visible', timeout: 5000 })
        if (await readRevision() !== beforeFirstAnnotation + 1) {
          throw new Error('第一次绘制标注没有一次完成，或产生了多余 revision')
        }
        const annotationParameters = editor.locator('[data-tool-parameters]')
        const annotationColor = annotationParameters.locator('input[type="color"]')
        await annotationColor.waitFor({ state: 'visible', timeout: 5000 })
        const testedAnnotationColor = `#${'0'.repeat(6)}`
        const beforeAnnotationColorRevision = await readRevision()
        await annotationColor.evaluate((input, nextColor) => {
          const valueSetter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'value',
          )?.set
          valueSetter?.call(input, nextColor)
          input.dispatchEvent(new Event('input', { bubbles: true }))
          input.dispatchEvent(new Event('change', { bubbles: true }))
        }, testedAnnotationColor)
        await page.waitForFunction((revision) => {
          return Number(document.querySelector('[data-command-bar]')
            ?.getAttribute('data-document-revision')) === revision + 1
        }, beforeAnnotationColorRevision, { timeout: 10000 }).catch(() => {
          throw new Error('修改选中标注颜色后没有提交文档 revision')
        })
        const annotationStroke = annotationParameters.getByRole('slider', {
          name: /^(描边|Stroke)$/i,
        })
        if (Number(await annotationStroke.inputValue()) !== 1.5) {
          throw new Error(`新标注默认描边不是 1.5%：${await annotationStroke.inputValue()}`)
        }
        const commandBarActions = editor.locator('[data-command-bar-actions]')
        await commandBarActions.evaluate((actions) => {
          const records = [{
            text: actions.textContent ?? '',
            width: actions.getBoundingClientRect().width,
          }]
          const observer = new MutationObserver(() => {
            records.push({
              text: actions.textContent ?? '',
              width: actions.getBoundingClientRect().width,
            })
          })
          observer.observe(actions, { childList: true, characterData: true, subtree: true })
          window.__imageEditorCommandBarActionsObservation = { observer, records }
        })
        const beforeAnnotationStrokeRevision = await readRevision()
        await annotationStroke.evaluate((input) => {
          const valueSetter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'value',
          )?.set
          valueSetter?.call(input, '1.4')
          input.dispatchEvent(new Event('input', { bubbles: true }))
          input.dispatchEvent(new Event('change', { bubbles: true }))
        })
        await page.waitForFunction((revision) => {
          return Number(document.querySelector('[data-command-bar]')
            ?.getAttribute('data-document-revision')) === revision + 1
        }, beforeAnnotationStrokeRevision, { timeout: 10000 }).catch(() => {
          throw new Error('修改选中标注描边后没有提交文档 revision')
        })
        if (await annotationColor.inputValue() !== testedAnnotationColor
          || Number(await annotationStroke.inputValue()) !== 1.4) {
          throw new Error('选中标注的颜色或描边没有同步回工具栏')
        }
        if (!(await annotationParameters.textContent())?.includes('1.4%')) {
          throw new Error('标注描边没有以百分比显示')
        }
        await page.waitForTimeout(700)
        const actionObservation = await commandBarActions.evaluate(() => {
          const observation = window.__imageEditorCommandBarActionsObservation
          observation?.observer.disconnect()
          delete window.__imageEditorCommandBarActionsObservation
          return observation?.records ?? []
        })
        const transientInternalStatus = actionObservation.find(({ text }) => (
          /版本\s*\d+|正在保存|Saving/i.test(text)
        ))
        const actionWidths = actionObservation.map(({ width }) => width)
        if (transientInternalStatus
          || Math.max(...actionWidths) - Math.min(...actionWidths) > 0.5) {
          throw new Error(`参数提交时右上角出现瞬时状态或位移：${JSON.stringify(actionObservation)}`)
        }

        const beforeAnnotationMove = await readRevision()
        await page.mouse.move(
          (annotationStartX + annotationEndX) / 2,
          (annotationStartY + annotationEndY) / 2,
        )
        await page.mouse.down()
        await page.mouse.move(
          (annotationStartX + annotationEndX) / 2 + 44,
          (annotationStartY + annotationEndY) / 2 + 28,
          { steps: 8 },
        )
        if (await readRevision() !== beforeAnnotationMove) {
          throw new Error('标注拖动过程中提前提交了 revision')
        }
        await page.mouse.up()
        await page.waitForFunction((revision) => {
          return Number(document.querySelector('[data-command-bar]')
            ?.getAttribute('data-document-revision')) === revision + 1
        }, beforeAnnotationMove, { timeout: 3000 }).catch(() => {
          throw new Error('标注无法直接拖动，或松手后没有提交唯一 revision')
        })

        const beforeArrow = await readRevision()
        await editor.getByRole('button', { name: /^(箭头标注|Arrow annotation)$/i }).click()
        await page.mouse.move(
          visibleAnnotationBox.x + visibleAnnotationBox.width * 0.24,
          visibleAnnotationBox.y + visibleAnnotationBox.height * 0.76,
        )
        await page.mouse.down()
        await page.mouse.move(
          visibleAnnotationBox.x + visibleAnnotationBox.width * 0.76,
          visibleAnnotationBox.y + visibleAnnotationBox.height * 0.24,
          { steps: 8 },
        )
        await page.mouse.up()
        await page.waitForFunction((revision) => {
          return Number(document.querySelector('[data-command-bar]')
            ?.getAttribute('data-document-revision')) === revision + 1
            && document.querySelector('[data-annotation-editor-overlay]')
              ?.getAttribute('data-selected-annotation-type') === 'arrow'
        }, beforeArrow, { timeout: 3000 }).catch(() => {
          throw new Error('箭头第一次绘制没有立即创建并选中')
        })

        await page.waitForTimeout(260)
        const annotationRenderStarts = await page.evaluate(async (afterTimestamp) => {
          const result = await window.henjiNative.logging.queryLogEvents({
            date: new Date().toISOString().slice(0, 10),
            afterTimestamp,
            level: 'debug',
            limit: 300,
          })
          return result.events.filter((event) => (
            event.event === 'image_editor_v3.preview.started'
            || event.event === 'image_editor_v3.viewport_composite.start'
          )).length
        }, annotationStartedAt)
        if (annotationRenderStarts !== 0) {
          throw new Error(`标注编辑错误触发了 ${annotationRenderStarts} 次底图/模糊重算`)
        }

        const addLayer = editor.getByRole('button', { name: /^(添加图层|Add layer)$/i })
        await addLayer.click()
        await page.getByRole('menuitem', { name: /^(模糊|Blur)$/i }).click()
        const blur = editor.locator('[role="treeitem"][data-layer-type="effect"]')
          .filter({ hasText: /^(模糊|Blur)$/i }).first()
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
        const beforeBlurRevision = await readRevision()
        const blurStartedAt = new Date().toISOString()
        const blurBox = await blurRadius.boundingBox()
        if (!blurBox) throw new Error('无法读取模糊半径滑杆范围')
        await page.mouse.move(blurBox.x + blurBox.width * 0.2, blurBox.y + blurBox.height / 2)
        await page.mouse.down()
        await page.mouse.move(
          blurBox.x + blurBox.width * 0.68,
          blurBox.y + blurBox.height / 2,
          { steps: 30 },
        )
        await page.mouse.up()
        await page.waitForFunction((revision) => {
          return Number(document.querySelector('[data-command-bar]')
            ?.getAttribute('data-document-revision')) === revision + 1
        }, beforeBlurRevision, { timeout: 5000 })
        await page.waitForFunction(async ({ afterTimestamp, revision }) => {
          const result = await window.henjiNative.logging.queryLogEvents({
            date: new Date().toISOString().slice(0, 10),
            afterTimestamp,
            level: 'debug',
            limit: 200,
          })
          const previewCompleted = result.events.some((event) => (
            event.event === 'image_editor_v3.preview.completed'
              && Number(event.context?.revision) === revision
              && event.context?.quality === 'stable'
          ))
          const vgpuCompleted = result.events.some((event) => (
            event.event === 'image_editor_v3.fast_blur.preview.completed'
              && event.context?.backend === 'vgpu'
          ))
          const durations = result.events
            .filter((event) => event.event === 'image_editor_v3.preview.completed')
            .map((event) => Number(event.context?.durationMs))
            .filter((duration) => Number.isFinite(duration))
          return previewCompleted
            && vgpuCompleted
            && durations.length > 0
            && Math.max(...durations) <= 500
        }, {
          afterTimestamp: blurStartedAt,
          revision: beforeBlurRevision + 1,
        }, { timeout: 5000 }).catch(() => {
          throw new Error('模糊拖动未在 500ms 内产出 vGPU 完成帧')
        })
        await page.waitForTimeout(160)
        await waitForVisibleRasterPixels('调整模糊半径')
        if (await readRevision() !== beforeBlurRevision + 1) {
          throw new Error('一次模糊滑杆拖动产生了多条历史 revision')
        }
        const frameBeforeZeroBlur = await displayFrame.boundingBox()
        const zeroBlurSliderBox = await blurRadius.boundingBox()
        if (!frameBeforeZeroBlur || !zeroBlurSliderBox) throw new Error('模糊归零前无法读取画面范围')
        const beforeZeroBlurRevision = await readRevision()
        const zeroBlurStartedAt = new Date().toISOString()
        await page.mouse.move(
          zeroBlurSliderBox.x + zeroBlurSliderBox.width * 0.68,
          zeroBlurSliderBox.y + zeroBlurSliderBox.height / 2,
        )
        await page.mouse.down()
        await page.mouse.move(
          zeroBlurSliderBox.x + 1,
          zeroBlurSliderBox.y + zeroBlurSliderBox.height / 2,
          { steps: 5 },
        )
        const [frameDuringZeroBlur, liveBlurTransform] = await Promise.all([
          displayFrame.boundingBox(),
          editor.locator('[data-live-blur-feedback]').count().then(async (count) => (
            count > 0
              ? editor.locator('[data-live-blur-feedback]').evaluate((element) => element.style.transform)
              : ''
          )),
        ])
        await page.mouse.up()
        if (!frameDuringZeroBlur
          || Math.abs(frameDuringZeroBlur.width - frameBeforeZeroBlur.width) > 0.5
          || Math.abs(frameDuringZeroBlur.height - frameBeforeZeroBlur.height) > 0.5
          || /scale/i.test(liveBlurTransform)) {
          throw new Error('模糊归零期间错误缩放了图片画布')
        }
        await page.waitForFunction((revision) => {
          return Number(document.querySelector('[data-command-bar]')
            ?.getAttribute('data-document-revision')) === revision + 1
        }, beforeZeroBlurRevision, { timeout: 5000 }).catch(() => {
          throw new Error('模糊归零没有提交最终参数')
        })
        await page.waitForFunction(async ({ afterTimestamp, revision }) => {
          const result = await window.henjiNative.logging.queryLogEvents({
            date: new Date().toISOString().slice(0, 10),
            afterTimestamp,
            level: 'debug',
            limit: 200,
          })
          const previewCompleted = result.events.some((event) => (
            event.event === 'image_editor_v3.preview.completed'
              && Number(event.context?.revision) === revision
              && event.context?.quality === 'stable'
          ))
          const zeroBypassCompleted = result.events.some((event) => (
            event.event === 'image_editor_v3.fast_blur.preview.completed'
              && event.context?.backend === 'cpu'
              && Array.isArray(event.context?.fallbackReasons)
              && event.context.fallbackReasons.includes('radius-zero-bypass')
          ))
          return previewCompleted && zeroBypassCompleted
        }, {
          afterTimestamp: zeroBlurStartedAt,
          revision: beforeZeroBlurRevision + 1,
        }, { timeout: 5000 }).catch(() => {
          throw new Error('模糊归零没有产出即时原图帧')
        })
        await page.waitForTimeout(160)
        await waitForVisibleRasterPixels('模糊归零')

        const postEffectAnnotationStartedAt = new Date().toISOString()
        const beforePostEffectStroke = await readRevision()
        await annotationStroke.evaluate((input) => {
          const valueSetter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'value',
          )?.set
          valueSetter?.call(input, '2.4')
          input.dispatchEvent(new Event('input', { bubbles: true }))
          input.dispatchEvent(new Event('change', { bubbles: true }))
        })
        await page.waitForFunction((revision) => {
          return Number(document.querySelector('[data-command-bar]')
            ?.getAttribute('data-document-revision')) === revision + 1
        }, beforePostEffectStroke, { timeout: 2000 }).catch(() => {
          throw new Error('底图有效果时修改箭头描边没有即时提交')
        })
        await page.waitForTimeout(260)
        const postEffectAnnotationRenders = await page.evaluate(async (afterTimestamp) => {
          const result = await window.henjiNative.logging.queryLogEvents({
            date: new Date().toISOString().slice(0, 10),
            afterTimestamp,
            level: 'debug',
            limit: 200,
          })
          return result.events.filter((event) => (
            event.event === 'image_editor_v3.preview.started'
            || event.event === 'image_editor_v3.viewport_composite.start'
          )).length
        }, postEffectAnnotationStartedAt)
        if (postEffectAnnotationRenders !== 0) {
          throw new Error(`改变箭头描边错误重算了 ${postEffectAnnotationRenders} 次底图效果`)
        }

        const annotationLayer = editor.locator('[role="treeitem"][data-layer-type="annotation"]')
        await annotationLayer.locator('[data-layer-select]').click()
        const [annotationLayerBox, blurLayerBox, layerViewportBox] = await Promise.all([
          annotationLayer.boundingBox(),
          blur.boundingBox(),
          editor.locator('[role="tree"]').boundingBox(),
        ])
        if (!annotationLayerBox || !blurLayerBox || !layerViewportBox) {
          throw new Error('无法读取图层拖拽位置或列表视口')
        }
        const layerDragX = annotationLayerBox.x + annotationLayerBox.width / 2
        const layerDragStartY = annotationLayerBox.y + annotationLayerBox.height / 2
        await page.mouse.move(layerDragX, layerDragStartY)
        await page.mouse.down()
        await page.mouse.move(layerDragX, layerDragStartY + 30)
        await page.waitForFunction(() => (
          document.querySelector('[data-layer-type="annotation"]')
            ?.getAttribute('data-layer-drag-state') === 'dragging'
        ), undefined, { timeout: 2000 })
        await page.mouse.move(layerViewportBox.x + 2, layerDragStartY + 30)
        const horizontalLockedBox = await annotationLayer.boundingBox()
        if (!horizontalLockedBox
          || Math.abs(horizontalLockedBox.x - annotationLayerBox.x) > 1) {
          throw new Error('图层拖拽仍会跟随鼠标产生横向位移')
        }
        await page.mouse.move(layerDragX, Math.max(1, layerViewportBox.y - 80))
        const topLimitedBox = await annotationLayer.boundingBox()
        if (!topLimitedBox || topLimitedBox.y < layerViewportBox.y - 1) {
          throw new Error('图层拖拽可以超出列表视口顶部')
        }
        await page.mouse.move(
          layerDragX,
          layerViewportBox.y + layerViewportBox.height + 80,
        )
        const bottomLimitedBox = await annotationLayer.boundingBox()
        if (!bottomLimitedBox
          || bottomLimitedBox.y + bottomLimitedBox.height
            > layerViewportBox.y + layerViewportBox.height + 1) {
          throw new Error('图层拖拽可以超出列表视口底部')
        }
        await page.mouse.move(
          layerDragX,
          blurLayerBox.y + blurLayerBox.height / 2,
          { steps: 5 },
        )
        await page.waitForFunction(() => {
          const targets = [...document.querySelectorAll('[data-layer-type="effect"]')]
          const target = targets.find((row) => row.textContent?.match(/^(模糊|Blur)/))
          const indicator = target?.querySelector('[data-layer-drop-indicator]')
          return target?.getAttribute('data-layer-drag-state') === 'avoiding'
            && target instanceof HTMLElement
            && target.style.transform === 'translateY(-100%)'
            && indicator?.getAttribute('data-position') === 'after'
            && !target.className.includes('ring-inset')
        }, undefined, { timeout: 2000 }).catch(() => {
          throw new Error('图层拖拽没有显示行间插入位置，或目标图层没有实时向上避让')
        })
        await page.mouse.up()
        await page.waitForFunction(() => (
          [...document.querySelectorAll('[role="treeitem"][data-layer-type]')]
            .map((row) => row.getAttribute('data-layer-type'))
            .slice(0, 4)
            .join(',') === 'effect,effect,annotation,raster'
        ), undefined, { timeout: 3000 }).catch(() => {
          throw new Error('图层拖拽松手后没有提交预览中的顺序')
        })
        const moveLayerUp = editor.getByRole('button', { name: /^(上移图层|Move layer up)$/i })
        await moveLayerUp.click()
        await moveLayerUp.click()
        await page.waitForFunction(() => (
          [...document.querySelectorAll('[role="treeitem"][data-layer-type]')]
            .map((row) => row.getAttribute('data-layer-type'))
            .slice(0, 4)
            .join(',') === 'annotation,effect,effect,raster'
        ), undefined, { timeout: 3000 }).catch(() => {
          throw new Error('图层拖拽验证后没有恢复标注层顺序')
        })

        const beforeCropRevision = await readRevision()
        await editor.locator('[data-tool-id="crop"]').click()
        await editor.locator('[data-crop-overlay]').waitFor({ state: 'visible', timeout: 5000 })
        await editor.getByRole('button', { name: /^(向右旋转 90°|Rotate 90° right)$/i }).click()
        const cropDisplayFrame = editor.locator('[data-document-transparency-grid]')
        const cropDisplayBefore = await cropDisplayFrame.boundingBox()
        if (!cropDisplayBefore) throw new Error('裁剪交互无法读取底图显示范围')
        const cropOutputBefore = await editor.locator('[data-preview-surface]').evaluate((surface) => ({
          width: Number(surface.getAttribute('data-preview-output-width')),
          height: Number(surface.getAttribute('data-preview-output-height')),
        }))
        await editor.getByRole('button', {
          name: /^(裁剪比例: 自由|Crop ratio: Free)$/i,
        }).click()
        const cropRatioMenu = page.getByRole('menu', {
          name: /^(裁剪比例|Crop ratio)$/i,
        })
        await cropRatioMenu.waitFor({ state: 'visible', timeout: 3000 })
        if (await cropRatioMenu.getByRole('menuitemradio').count() !== 9) {
          throw new Error('裁剪比例特殊面板没有完整展示 9 个比例选项')
        }
        await cropRatioMenu.getByRole('menuitemradio', { name: '1:1', exact: true }).click()
        await cropRatioMenu.waitFor({ state: 'hidden', timeout: 3000 })
        const cropLayout = await editor.locator('[data-crop-parameters]').evaluate((parameters) => {
          const commandBar = parameters.closest('[data-command-bar]')
          const viewport = parameters.closest('[data-tool-parameter-viewport]')
          const inputWidths = [...parameters.querySelectorAll('input')]
            .filter((element) => element instanceof HTMLInputElement)
            .map((element) => element.getBoundingClientRect().width)
          return {
            insideCommandBar: Boolean(commandBar),
            inputWidths,
            viewportScrollLeft: viewport?.scrollLeft ?? -1,
            viewportWidth: viewport?.clientWidth ?? 0,
            contentWidth: parameters.scrollWidth,
          }
        })
        if (!cropLayout.insideCommandBar
          || cropLayout.inputWidths.length < 4
          || cropLayout.inputWidths.some((width) => width > 72)
          || cropLayout.viewportScrollLeft !== 0
          || cropLayout.contentWidth > cropLayout.viewportWidth + 1) {
          throw new Error(`裁剪参数布局仍然过宽或另起一行：${JSON.stringify(cropLayout)}`)
        }
        await page.waitForFunction(() => {
          const values = [...document.querySelectorAll('[data-crop-parameters] input')]
            .filter((element) => element instanceof HTMLInputElement)
            .map((element) => Number(element.value))
          return values.length >= 4 && values[2] === values[3]
        }, undefined, { timeout: 5000 })
        const cropValuesBeforeDrag = await editor.locator('[data-crop-parameters] input')
          .evaluateAll((inputs) => inputs.map((input) => Number(input.value)))
        const cropHandle = editor.locator('[data-crop-handle="se"]')
        const cropHandleBox = await cropHandle.boundingBox()
        if (!cropHandleBox) throw new Error('裁剪交互无法读取右下控制点')
        await page.mouse.move(
          cropHandleBox.x + cropHandleBox.width / 2,
          cropHandleBox.y + cropHandleBox.height / 2,
        )
        await page.mouse.down()
        await page.mouse.move(
          cropHandleBox.x + cropHandleBox.width / 2 - 72,
          cropHandleBox.y + cropHandleBox.height / 2 - 72,
          { steps: 8 },
        )
        await page.mouse.up()
        await page.waitForFunction((before) => {
          const values = [...document.querySelectorAll('[data-crop-parameters] input')]
            .filter((element) => element instanceof HTMLInputElement)
            .map((element) => Number(element.value))
          return values[2] !== before[2] || values[3] !== before[3]
        }, cropValuesBeforeDrag, { timeout: 3000 })
        const [cropDisplayDuring, cropOutputDuring] = await Promise.all([
          cropDisplayFrame.boundingBox(),
          editor.locator('[data-preview-surface]').evaluate((surface) => ({
            width: Number(surface.getAttribute('data-preview-output-width')),
            height: Number(surface.getAttribute('data-preview-output-height')),
          })),
        ])
        if (!cropDisplayDuring
          || Math.abs(cropDisplayDuring.x - cropDisplayBefore.x) > 0.5
          || Math.abs(cropDisplayDuring.y - cropDisplayBefore.y) > 0.5
          || Math.abs(cropDisplayDuring.width - cropDisplayBefore.width) > 0.5
          || Math.abs(cropDisplayDuring.height - cropDisplayBefore.height) > 0.5
          || cropOutputDuring.width !== cropOutputBefore.width
          || cropOutputDuring.height !== cropOutputBefore.height) {
          throw new Error(`拖动裁剪框时底图发生变化：${JSON.stringify({
            cropDisplayBefore,
            cropDisplayDuring,
            cropOutputBefore,
            cropOutputDuring,
          })}`)
        }
        if (await readRevision() !== beforeCropRevision) {
          throw new Error('裁剪框或比例预览在应用前提前写入了历史')
        }
        await editor.getByRole('button', { name: /^(应用裁剪|Apply crop)$/i }).click()
        await page.waitForFunction((revision) => {
          return Number(document.querySelector('[data-command-bar]')
            ?.getAttribute('data-document-revision')) === revision + 1
        }, beforeCropRevision, { timeout: 5000 })
        await editor.locator('[data-crop-overlay]').waitFor({ state: 'hidden', timeout: 3000 })
        if (await editor.locator('[data-tool-id="move"]').getAttribute('aria-pressed') !== 'true') {
          throw new Error('应用裁剪后没有回到移动工具展示最终裁剪结果')
        }
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
        await annotationTool.click()
        await editor.getByRole('button', { name: /^(打码|Redact)$/i }).click()
        await editor.getByRole('group', {
          name: /^(打码方式|Redaction mode)$/i,
        }).waitFor({ state: 'visible', timeout: 5000 })
        await editor.getByRole('button', { name: /^(圆形标注|Ellipse annotation)$/i }).click()
        const finalAnnotationOverlay = editor.locator('[data-annotation-editor-overlay]')
        if (await finalAnnotationOverlay.getAttribute('data-selected-annotation-type')) {
          await page.keyboard.press('Delete')
          await page.waitForFunction(() => (
            !document.querySelector('[data-annotation-editor-overlay]')
              ?.getAttribute('data-selected-annotation-type')
          ), undefined, { timeout: 3000 })
        }
        const finalAnnotationBox = await finalAnnotationOverlay.boundingBox()
        if (!finalAnnotationBox) throw new Error('控制点视觉验收无法读取标注画布')
        const beforeFinalAnnotation = await readRevision()
        await page.mouse.move(
          finalAnnotationBox.x + finalAnnotationBox.width * 0.82,
          finalAnnotationBox.y + finalAnnotationBox.height * 0.72,
        )
        await page.mouse.down()
        await page.mouse.move(
          finalAnnotationBox.x + finalAnnotationBox.width * 0.95,
          finalAnnotationBox.y + finalAnnotationBox.height * 0.9,
          { steps: 6 },
        )
        await page.mouse.up()
        await page.waitForFunction((revision) => (
          Number(document.querySelector('[data-command-bar]')
            ?.getAttribute('data-document-revision')) === revision + 1
            && document.querySelector('[data-annotation-editor-overlay]')
              ?.getAttribute('data-selected-annotation-type') === 'ellipse'
        ), beforeFinalAnnotation, { timeout: 5000 }).catch(async () => {
          const state = await editor.evaluate((root) => ({
            revision: root.querySelector('[data-command-bar]')
              ?.getAttribute('data-document-revision'),
            drawing: root.querySelector('[data-annotation-editor-overlay]')
              ?.getAttribute('data-annotation-drawing'),
            selectedType: root.querySelector('[data-annotation-editor-overlay]')
              ?.getAttribute('data-selected-annotation-type'),
            liveLayerCount: root.querySelector('[data-annotation-editor-overlay]')
              ?.getAttribute('data-live-annotation-layer-count'),
            ellipsePressed: root.querySelector('[data-annotation-tool-id="annotation-ellipse"]')
              ?.getAttribute('aria-pressed'),
          }))
          throw new Error(`控制点视觉验收没有成功创建并选中椭圆标注：${JSON.stringify(state)}`)
        })
        await preview.getByRole('img').first().waitFor({ state: 'visible', timeout: 15000 })
        await preview.locator('.animate-spin').waitFor({ state: 'hidden', timeout: 15000 })
        await editor.locator('[data-tool-id="crop"]').click()
        await editor.getByRole('button', {
          name: /^(裁剪比例: 1:1|Crop ratio: 1:1)$/i,
        }).click()
        await page.getByRole('menu', {
          name: /^(裁剪比例|Crop ratio)$/i,
        }).waitFor({ state: 'visible', timeout: 3000 })
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
