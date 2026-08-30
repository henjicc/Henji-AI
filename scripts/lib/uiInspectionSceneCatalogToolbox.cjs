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
          const dropTarget = surface.locator('.border-dashed').first()
          await dropTarget.waitFor({ state: 'visible', timeout: 8000 })
          const fixturePath = process.env.HENJI_VGPU_GLOW_FIXTURE_IMAGE
          const externalFixture = fixturePath ? {
            bytes: Array.from(await require('node:fs/promises').readFile(fixturePath)),
            name: require('node:path').basename(fixturePath),
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
          await page.getByRole('button', { name: '辉光 Pro' }).waitFor({ state: 'visible', timeout: 12000 })
          await page.getByRole('button', { name: '辉光 Pro' }).click()
          await page.getByRole('heading', { name: '辉光 Pro' }).waitFor({ state: 'visible', timeout: 8000 })
          await page.getByRole('switch', { name: '启用辉光 Pro' }).click()
          await settlePage(page, 1200)
        }

        // 第一轮主动推进多次 revision，再重新打开编辑器。旧实现的 Worker 记住了全局最大值，
        // 第二轮从 revision 1 起步会被永久判旧；这个场景必须在同一 Electron 进程里复现它。
        await openGlowEditor()
        const intensity = page.getByRole('slider', { name: '发光强度' })
        await intensity.focus()
        for (let index = 0; index < 6; index += 1) await intensity.press('ArrowRight')
        await settlePage(page, 1200)
        await page.getByRole('button', { name: '返回工具箱' }).click()
        await openGlowEditor()
        await page.getByRole('switch', { name: '启用辉光着色' }).click()
        const tint = page.getByLabel('辉光颜色')
        await tint.fill('#ff4bd8')
        await page.getByRole('switch', { name: '启用辉光着色' }).click()
        const radius = page.getByRole('slider', { name: '发光半径' })
        await radius.fill('1')
        const chromaticAberration = page.getByRole('slider', { name: '色差' })
        await chromaticAberration.fill(process.env.HENJI_VGPU_GLOW_CHROMA ?? '0.78')
        await page.getByRole('button', { name: '左侧色光绿' }).click()
        await page.getByRole('button', { name: '右侧色光红' }).click()
        if (await page.getByText('辉光预览失败').count()) {
          throw new Error('重新打开图片编辑器后，辉光预览仍被旧会话 revision 取消')
        }
        await settlePage(page, 2200)
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
