const { writeFile } = require('node:fs/promises')
const { captureInspectionPage } = require('./uiInspectionCapture.cjs')

async function assertStableWorkbenchSelection(page, shell, otherNode, editor, electronApp, name, restoreSelection = true) {
  await page.mouse.move(20, 100)
  await editor.evaluate(element => {
    if (element.contains(document.activeElement)) document.activeElement.blur()
  })
  await page.waitForTimeout(350)
  const element = await editor.elementHandle()
  const before = await editor.evaluate(root => ({ html: root.innerHTML, width: root.clientWidth, height: root.clientHeight,
    scroll: Array.from(root.querySelectorAll('*')).map(child => child.scrollTop) }))
  const captureBefore = await captureInspectionPage(electronApp, page)
  await otherNode.click()
  await page.mouse.move(20, 100)
  await page.waitForTimeout(350)
  if (!await element.evaluate(root => root.isConnected)) throw new Error(`${name}取消选中后工作面被卸载`)
  const after = await editor.evaluate(root => ({ html: root.innerHTML, width: root.clientWidth, height: root.clientHeight,
    scroll: Array.from(root.querySelectorAll('*')).map(child => child.scrollTop) }))
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error(`${name}选中切换改变了工作面内容、尺寸或滚动位置`)
  const captureAfter = await captureInspectionPage(electronApp, page)
  const sharp = require('sharp')
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  const box = await editor.boundingBox()
  const metadata = await sharp(captureBefore).metadata()
  const rect = { left: Math.ceil(box.x * metadata.width / viewport.width) + 2,
    top: Math.ceil(box.y * metadata.height / viewport.height) + 2,
    width: Math.floor(box.width * metadata.width / viewport.width) - 4,
    height: Math.floor(box.height * metadata.height / viewport.height) - 4 }
  const a = await sharp(captureBefore).extract(rect).removeAlpha().raw().toBuffer()
  const b = await sharp(captureAfter).extract(rect).removeAlpha().raw().toBuffer()
  let changed = 0
  for (let i = 0; i < a.length; i += 3) if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) > 8) changed++
  if (changed / (a.length / 3) > 0.001) throw new Error(`${name}选中切换的工作面像素差超过容差：${changed}`)
  await writeFile(`.ui-tour/${name}-unselected.png`, captureAfter)
  const idleMutations = await editor.evaluate(async root => {
    let changes = 0
    const observer = new MutationObserver(records => { changes += records.length })
    observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true })
    // 探针自检：只改测试属性，并在计数前还原，不影响显示。
    root.setAttribute('data-idle-probe', '1')
    root.removeAttribute('data-idle-probe')
    await Promise.resolve()
    if (changes !== 2) throw new Error('工作面闲置探针未生效')
    changes = 0
    await new Promise(resolve => setTimeout(resolve, 1000))
    observer.disconnect()
    return changes
  })
  if (idleMutations) throw new Error(`${name}闲置时发生 ${idleMutations} 次内容更新`)
  if (restoreSelection) {
    await shell.click({ position: { x: 4, y: 4 } })
    if (!await element.evaluate(root => root.isConnected)) throw new Error(`${name}再次选中后工作面被重建`)
  }
}

module.exports = { assertStableWorkbenchSelection }
