'use strict'

/** 找一个真正落在 React Flow pane 上、不会拖到节点或控件的抓取点。 */
async function findPanePoint(page, { preferRatioX = 0.86, preferRatioY = 0.5 } = {}) {
  return page.evaluate((prefer) => {
    const flow = document.querySelector('.react-flow')
    if (!flow) return null
    const rect = flow.getBoundingClientRect()
    const margin = 40
    const baseX = rect.left + rect.width * prefer.preferRatioX
    const baseY = rect.top + rect.height * prefer.preferRatioY
    const xOffsets = [0, -60, 60, -140, 140, -240, 240, -360, 360]
    const yOffsets = [0, -80, 80, -180, 180, -280, 280, -400, 400, -520, 520]

    for (const dy of yOffsets) {
      for (const dx of xOffsets) {
        const x = Math.round(baseX + dx)
        const y = Math.round(baseY + dy)
        if (x < rect.left + margin || x > rect.right - margin) continue
        if (y < rect.top + margin || y > rect.bottom - margin) continue
        const element = document.elementFromPoint(x, y)
        if (!element || element.closest('.react-flow__node')) continue
        if (element.closest('.react-flow__minimap')) continue
        if (element.closest('.react-flow__controls')) continue
        if (element.closest('.react-flow__panel')) continue
        if (!element.closest('.react-flow__pane')) continue
        return { x, y }
      }
    }
    return null
  }, { preferRatioX, preferRatioY })
}

function dispatch(session, params) {
  // 不 await：await 每一次派发会把输入频率压到约 30Hz，真实差异会被掩盖。
  session.send('Input.dispatchMouseEvent', params).catch(() => undefined)
}

async function releasePointer(session, point) {
  await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 })
  await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point, button: 'none', buttons: 0 })
}

module.exports = { dispatch, findPanePoint, releasePointer }
