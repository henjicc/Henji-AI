'use strict'

/**
 * 画布大规模的交互核对：远景里多数节点没有真 DOM，逐项确认命中、落点与浮层锚定仍然成立。
 * 每一项都以保存下来的画布文档或界面上实际出现的元素为准，不读内部状态。
 */

const path = require('node:path')

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }

async function readViewport(page) {
  return page.evaluate(() => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.react-flow__viewport')).transform)
    return { x: matrix.e, y: matrix.f, zoom: matrix.a }
  })
}

async function waitFor(read, accept, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs
  let value = await read()
  while (!accept(value) && Date.now() < deadline) { await sleep(300); value = await read() }
  return value
}

/**
 * @param page Playwright 页面
 * @param context { docId, graph, sizes, spacing: { x, y }, outDir, groupId }
 */
async function runInteractionChecks(page, context) {
  const { docId, graph, sizes, outDir, groupId } = context
  const checks = []
  const record = (name, pass, detail) => { checks.push({ name, pass: Boolean(pass), detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail)}`) }
  const box = await page.locator('.react-flow').boundingBox()
  const nodeOf = id => graph.nodes.find(node => node.id === id)
  const sizeOf = node => node.measured ?? sizes[node.type] ?? { width: 280, height: 200 }
  /** 节点内某个相对位置在屏幕上的坐标 */
  const pointOf = async (id, fx = 0.5, fy = 0.5) => {
    const view = await readViewport(page)
    const node = nodeOf(id)
    const size = sizeOf(node)
    return { x: box.x + view.x + (node.position.x + size.width * fx) * view.zoom, y: box.y + view.y + (node.position.y + size.height * fy) * view.zoom }
  }
  const rectOf = async (id) => {
    const topLeft = await pointOf(id, 0, 0)
    const bottomRight = await pointOf(id, 1, 1)
    return { left: topLeft.x, top: topLeft.y, right: bottomRight.x, bottom: bottomRight.y }
  }
  const readDoc = () => page.evaluate(id => window.henjiNative.testFixtures.readCanvas(id), docId)
  const domNodeIds = () => page.evaluate(() => Array.from(document.querySelectorAll('.react-flow__node')).map(node => node.dataset.id))
  /** 两列节点之间的缝：最宽的节点 427、列距 460，取 445 处。画布场景里这里没有节点，才算真正的空白 */
  const gapOf = id => pointOf(id, 445 / sizeOf(nodeOf(id)).width, 0.5)
  const blank = await gapOf('scale-5')
  const shot = name => page.screenshot({ path: path.join(outDir, `interact-${name}.png`) })

  // 一、远景悬停与点选：指针下出现一个空外框，点选后工具栏锚在节点上，指针离开后不跳走
  const first = await pointOf('scale-0')
  await page.mouse.move(first.x - 3, first.y - 3)
  await page.mouse.move(first.x, first.y)
  await sleep(200)
  record('远景悬停只多出指针下一个节点元素', (await domNodeIds()).join() === 'scale-0', { dom: await domNodeIds() })
  await page.mouse.click(first.x, first.y)
  await sleep(400)
  await page.mouse.move(blank.x, blank.y)
  await sleep(600)
  const toolbar = await page.evaluate(() => {
    const element = document.querySelector('.react-flow__node-toolbar [data-node-toolbar-panel]') ?? document.querySelector('.react-flow__node-toolbar')
    const rect = element?.getBoundingClientRect()
    return rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null
  })
  const firstRect = await rectOf('scale-0')
  const centerX = toolbar ? (toolbar.left + toolbar.right) / 2 : NaN
  // 工具栏贴着节点上沿或下沿，水平方向与节点重叠（靠边时会被夹回画布内，所以按重叠判断）
  const anchored = Boolean(toolbar) && toolbar.right > firstRect.left - 4 && toolbar.left < firstRect.right + 240
    && (Math.abs(toolbar.bottom - firstRect.top) < 90 || Math.abs(toolbar.top - firstRect.bottom) < 90)
  record('远景点选后工具栏锚在节点上（指针离开、外框撤掉之后）', anchored, { toolbar, node: firstRect, centerX, domAfterLeave: await domNodeIds() })
  await shot('far-select')

  // 二、远景右键：生成节点弹出菜单
  const generator = graph.nodes.find(node => node.type === 'imageNode')
  const generatorPoint = await pointOf(generator.id)
  await page.mouse.move(generatorPoint.x - 3, generatorPoint.y)
  await page.mouse.move(generatorPoint.x, generatorPoint.y)
  await sleep(150)
  await page.mouse.click(generatorPoint.x, generatorPoint.y, { button: 'right' })
  await sleep(400)
  const menuItems = await page.evaluate(() => Array.from(document.querySelectorAll('[data-context-menu] [role="menuitem"]')).map(item => item.textContent))
  record('远景右键节点弹出节点菜单', menuItems.length > 0, { menuItems, node: generator.id })
  await shot('far-context-menu')
  await page.keyboard.press('Escape')
  await sleep(200)

  // 三、远景把节点拖进素材组：按被拖节点的中心落在素材组里判定
  const groupDoc = (await readDoc()).nodes.find(node => node.id === groupId)
  const groupSize = groupDoc?.measured ?? { width: 200, height: 200 }
  nodeOf(groupId).measured = groupSize
  const member = 'scale-1'
  const from = await pointOf(member)
  const to = await pointOf(groupId)
  await page.mouse.move(from.x - 3, from.y)
  await page.mouse.move(from.x, from.y)
  await sleep(150)
  await page.mouse.down()
  for (let step = 1; step <= 24; step += 1) {
    await page.mouse.move(from.x + (to.x - from.x) * step / 24, from.y + (to.y - from.y) * step / 24)
    await sleep(16)
  }
  await sleep(120)
  await page.mouse.up()
  const grouped = await waitFor(readDoc, doc => {
    const group = doc.nodes.find(node => node.id === groupId)
    return (group?.data?.memberOrder ?? []).includes(member) || doc.nodes.find(node => node.id === member)?.parentId === groupId
  })
  const groupAfter = grouped.nodes.find(node => node.id === groupId)
  record('远景把节点拖进素材组', (groupAfter?.data?.memberOrder ?? []).includes(member) || grouped.nodes.find(node => node.id === member)?.parentId === groupId,
    { memberOrder: groupAfter?.data?.memberOrder, groupMeasured: groupSize })
  await shot('far-asset-group')
  await page.mouse.click(blank.x, blank.y)
  await sleep(300)

  // 四、远景多选批量连线：从工具栏按钮拖到一个没有真 DOM 的生成节点上
  const sources = ['scale-2', 'scale-3']
  for (const [index, id] of sources.entries()) {
    const point = await pointOf(id)
    await page.mouse.move(point.x - 3, point.y)
    await page.mouse.move(point.x, point.y)
    await sleep(150)
    if (index > 0) await page.keyboard.down('Control')
    await page.mouse.click(point.x, point.y)
    if (index > 0) await page.keyboard.up('Control')
    await sleep(250)
  }
  const edgesBefore = (await readDoc()).edges.length
  const handle = await page.locator('button[aria-label="批量连接所选素材"], button[aria-label="Connect selected media"]').first().boundingBox().catch(() => null)
  if (handle) {
    const start = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    for (let step = 1; step <= 20; step += 1) {
      await page.mouse.move(start.x + (generatorPoint.x - start.x) * step / 20, start.y + (generatorPoint.y - start.y) * step / 20)
      await sleep(16)
    }
    await page.mouse.up()
  }
  const batchDoc = await waitFor(readDoc, doc => sources.every(source => doc.edges.some(edge => edge.source === source && edge.target === generator.id)))
  record('远景多选批量连线落在没有真 DOM 的节点上', sources.every(source => batchDoc.edges.some(edge => edge.source === source && edge.target === generator.id)),
    { handleFound: Boolean(handle), edgesBefore, edgesAfter: batchDoc.edges.length, target: generator.id })
  await shot('far-batch-connect')
  await page.mouse.click(blank.x, blank.y)
  await sleep(300)

  // 四之二、远景框选：只选中框里的节点。没挂过真 DOM 的节点不能被当成“都在框里”
  const boxFrom = await pointOf('scale-6', -0.08, -0.3)
  const boxTo = await pointOf('scale-7', 1.04, 1.2)
  await page.keyboard.down('Control')
  await page.mouse.move(boxFrom.x, boxFrom.y)
  await page.mouse.down()
  for (let step = 1; step <= 12; step += 1) {
    await page.mouse.move(boxFrom.x + (boxTo.x - boxFrom.x) * step / 12, boxFrom.y + (boxTo.y - boxFrom.y) * step / 12)
    await sleep(16)
  }
  await page.mouse.up()
  await page.keyboard.up('Control')
  await sleep(500)
  const selectionLabel = await page.evaluate(() => Array.from(document.querySelectorAll('.react-flow__node-toolbar button')).map(button => button.textContent).find(text => /下载\s*\d+|Download\s*\d+/.test(text ?? '')) ?? '')
  const selectedCount = Number(/\d+/.exec(selectionLabel)?.[0] ?? NaN)
  record('远景框选只选中框里的节点', selectedCount === 2, { selectionLabel, expected: 2 })
  await shot('far-box-select')
  await page.mouse.click(blank.x, blank.y)
  await sleep(300)

  // 五、远景文件拖放：落在节点上交给该节点，不在它上面另建节点；落在空白处新建节点并很快量到尺寸
  const dropFile = (point) => page.evaluate(async ({ x, y }) => {
    const canvas = document.createElement('canvas')
    canvas.width = 64; canvas.height = 48
    canvas.getContext('2d').fillRect(8, 8, 40, 24)
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
    const transfer = new DataTransfer()
    transfer.items.add(new File([blob], 'scale-drop.png', { type: 'image/png' }))
    const target = document.elementFromPoint(x, y)
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: transfer }))
    return target.className?.toString?.() ?? ''
  }, point)
  const countBefore = (await readDoc()).nodes.length
  const dropTarget = 'scale-4'
  await page.mouse.move(blank.x, blank.y)
  const droppedOn = await dropFile(await pointOf(dropTarget))
  await sleep(1500)
  const afterNodeDrop = await readDoc()
  const pinnedBody = await page.evaluate(id => Boolean(document.querySelector(`.react-flow__node[data-id="${id}"] .canvas-node-paint-frame`)), dropTarget)
  record('远景把文件拖到节点上：不另建节点，目标节点挂上正文接收', afterNodeDrop.nodes.length === countBefore && pinnedBody,
    { countBefore, countAfter: afterNodeDrop.nodes.length, pinnedBody, droppedOn })
  // 空白处：取两个节点之间的缝
  await dropFile(await gapOf('scale-6'))
  const afterBlankDrop = await waitFor(readDoc, doc => doc.nodes.length > countBefore && doc.nodes.slice(countBefore).every(node => node.measured?.width > 0))
  const created = afterBlankDrop.nodes.slice(countBefore)
  record('远景把文件拖到空白处：新建节点并量到尺寸', created.length === 1 && created[0].measured?.width > 0, { created: created.map(node => ({ id: node.id, type: node.type, measured: node.measured })) })
  await shot('far-file-drop')

  // 六、近景连线落点：从上传节点的输出端口拖到下方生成节点的正文中间（不是端口上）松手
  const sourceId = 'scale-0'
  const targetId = graph.nodes[graph.columns].id
  const anchor = await pointOf(sourceId, 0.5, 1.2)
  await page.mouse.move(anchor.x, anchor.y)
  for (let i = 0; i < 9; i += 1) { await page.mouse.wheel(0, -160); await sleep(40) }
  // 放大后第一行会顶出画布上沿：按住中键把画面往下带，让起点节点整个露出来
  const grip = { x: box.x + box.width / 2, y: box.y + 60 }
  await page.mouse.move(grip.x, grip.y)
  await page.mouse.down({ button: 'middle' })
  for (let step = 1; step <= 15; step += 1) { await page.mouse.move(grip.x + 40, grip.y + step * 20); await sleep(16) }
  await page.mouse.up({ button: 'middle' })
  await sleep(2500)
  const view = await readViewport(page)
  const sourceHandle = await page.locator(`.react-flow__node[data-id="${sourceId}"] .react-flow__handle.source`).first().boundingBox().catch(() => null)
  const targetPoint = await pointOf(targetId, 0.5, 0.75)
  if (sourceHandle) {
    const start = { x: sourceHandle.x + sourceHandle.width / 2, y: sourceHandle.y + sourceHandle.height / 2 }
    await page.mouse.move(start.x, start.y)
    await sleep(120)
    await page.mouse.down()
    for (let step = 1; step <= 20; step += 1) {
      await page.mouse.move(start.x + (targetPoint.x - start.x) * step / 20, start.y + (targetPoint.y - start.y) * step / 20)
      await sleep(16)
    }
    await sleep(100)
    await page.mouse.up()
  }
  const connected = await waitFor(readDoc, doc => doc.edges.some(edge => edge.source === sourceId && edge.target === targetId))
  record('近景连线松手在节点正文上：按落点连到该节点', connected.edges.some(edge => edge.source === sourceId && edge.target === targetId),
    { zoom: view.zoom, handleFound: Boolean(sourceHandle), source: sourceId, target: targetId, targetType: nodeOf(targetId).type })
  await shot('near-connect')

  return checks
}

module.exports = { runInteractionChecks }
