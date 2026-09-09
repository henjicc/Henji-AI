const { writeFile } = require('node:fs/promises')
const { captureInspectionPage } = require('./uiInspectionCapture.cjs')

async function prepareRelightPortrait(page, projectId) {
  await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click()
  await page.locator(`[data-project-id="${projectId}"]:visible`).waitFor()
  await page.evaluate(async (id) => {
    const canvas = document.createElement('canvas')
    canvas.width = 300
    canvas.height = 600
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = 'rgb(190,194,182)'
    ctx.fillRect(0, 0, 300, 600)
    ctx.fillStyle = 'rgb(45,75,65)'
    ctx.beginPath()
    ctx.roundRect(65, 180, 170, 350, 28)
    ctx.fill()
    ctx.fillStyle = 'rgb(220,202,150)'
    ctx.fillRect(110, 110, 80, 80)
    ctx.fillStyle = 'rgb(245,240,220)'
    ctx.fillRect(80, 270, 140, 130)
    ctx.fillStyle = 'rgb(45,75,65)'
    ctx.font = '22px sans-serif'
    ctx.fillText('STUDIO', 105, 340)
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
    const source = await window.henjiNative.image.persistImageBinary(new Uint8Array(await blob.arrayBuffer()), 'png')
    const rows = await window.henjiNative.db.select('SELECT nodes_json FROM storyboard_projects WHERE id = ?', [id])
    const nodes = JSON.parse(rows[0].nodes_json)
    const node = nodes.find(item => item.id === '__ui_panorama_source')
    node.data = { ...node.data, imageUrl: source, previewImageUrl: source, aspectRatio: '1:2', displayName: '竖版产品参考图' }
    await window.henjiNative.db.execute('UPDATE storyboard_projects SET nodes_json = ? WHERE id = ?', [JSON.stringify(nodes), id])
  }, projectId)
  await page.locator(`[data-project-id="${projectId}"]:visible`).click()
  await page.locator('.react-flow__node[data-id="__ui_panorama_source"]').waitFor()
}

async function verifyRelightSpatial(page, editor, electronApp) {
  const main = editor.getByRole('slider', { name: '主光方向', exact: true })
  const plane = editor.locator('[data-relight-image-plane]')
  await page.waitForFunction(element => element.getAttribute('data-image-aspect') === '0.5', await plane.elementHandle())
  if (await editor.getByText('大光点调主光，小光点调轮廓光').count()) throw new Error('仍显示已移除的说明')
  for (const [name, key] of [['主光方向', 'main'], ['轮廓光方向', 'rim']]) {
    const control = editor.getByRole('slider', { name, exact: true })
    const initialZ = Number(await control.getAttribute('data-light-z'))
    await control.focus()
    await page.keyboard.press('End')
    if (Number(await control.getAttribute('data-light-z')) * initialZ >= 0) throw new Error(`${name}无法切换前后`)
    const layer = editor.locator(`[data-relight-light="${key}"]`)
    const front = Number(await control.getAttribute('data-light-z')) >= 0
    if (await layer.getAttribute('data-relight-depth') !== (front ? 'front' : 'back')) throw new Error('灯位与光束深度不一致')
    const afterImage = await layer.evaluate(element => Boolean(element.parentElement.querySelector('[data-relight-image-plane]')
      .compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING))
    if (afterImage !== front) throw new Error('灯光仍使用固定遮挡层')
    await control.evaluate(element => element.blur())
    await writeFile(`.ui-tour/canvas-relight-${key}-${front ? 'front' : 'back'}.png`, await captureInspectionPage(electronApp, page))
    await control.focus()
    await page.keyboard.press('End')
    await control.evaluate(element => element.blur())
    await writeFile(`.ui-tour/canvas-relight-${key}-${front ? 'back' : 'front'}.png`, await captureInspectionPage(electronApp, page))
  }
  await main.focus()
  await page.keyboard.press('ArrowRight')
  const box = await main.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.53, box.y + box.height / 2, { steps: 6 })
  await page.mouse.up()
  await main.evaluate(element => element.blur())
  await writeFile('.ui-tour/canvas-relight-spatial.png', await captureInspectionPage(electronApp, page))
  return { mainZ: await main.getAttribute('data-light-z'), rimZ: await editor.getByRole('slider', { name: '轮廓光方向' }).getAttribute('data-light-z') }
}

module.exports = { prepareRelightPortrait, verifyRelightSpatial }
