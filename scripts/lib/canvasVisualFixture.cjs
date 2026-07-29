'use strict'

const SELECTOR_TYPES = [
  'imageModelSelectorNode',
  'videoModelSelectorNode',
  'audioModelSelectorNode',
]

const DEFAULT_MODEL_IDS = {
  imageModelSelectorNode: 'nano-banana',
  videoModelSelectorNode: 'seedance-1.0-pro',
  audioModelSelectorNode: 'ppio-minimax-speech',
}

/**
 * 仅改本次临时 fixture：补齐三种模型选择器，并统一切到折叠或展开态。
 * 用于 2.1 同时验证三种媒体类型，不接触真实项目。
 */
async function prepareModelSelectorFixture(page, fixture, state) {
  if (!['collapsed', 'expanded'].includes(state)) return fixture
  const result = await page.evaluate(async ({ projectId, selectorTypes, defaultModelIds, expanded }) => {
    const rows = await window.henjiNative.db.select(
      'SELECT nodes_json FROM storyboard_projects WHERE id = ? LIMIT 1',
      [projectId]
    )
    if (!rows.length) throw new Error(`找不到临时项目：${projectId}`)
    const nodes = JSON.parse(rows[0].nodes_json)
    const template = nodes.find((node) => selectorTypes.includes(node.type))
    if (!template) throw new Error('源项目中没有可用于补齐模型选择器的模板节点')
    for (const [index, type] of selectorTypes.entries()) {
      let matchingNodes = nodes.filter((candidate) => candidate.type === type)
      if (!matchingNodes.length) {
        const node = {
          ...template,
          id: `__visual_${type}`,
          type,
          parentId: undefined,
          extent: undefined,
          position: {
            x: (template.position?.x ?? 0) + 600 + index * 80,
            y: (template.position?.y ?? 0) + 120 + index * 80,
          },
          data: {
            ...template.data,
            displayName: type,
            modelId: defaultModelIds[type],
          },
          selected: false,
        }
        nodes.push(node)
        matchingNodes = [node]
      }
      for (const node of matchingNodes) {
        const width = expanded ? 320 : 240
        const height = expanded ? 380 : 44
        node.data = { ...node.data, isExpanded: expanded }
        node.width = width
        node.height = height
        node.measured = { width, height }
        node.style = { ...(node.style ?? {}), width, height }
      }
    }

    await window.henjiNative.db.execute(
      'UPDATE storyboard_projects SET node_count = ?, nodes_json = ? WHERE id = ?',
      [nodes.length, JSON.stringify(nodes), projectId]
    )
    return { nodeCount: nodes.length }
  }, {
    projectId: fixture.projectId,
    selectorTypes: SELECTOR_TYPES,
    defaultModelIds: DEFAULT_MODEL_IDS,
    expanded: state === 'expanded',
  })
  return { ...fixture, nodeCount: result.nodeCount, selectorState: state }
}

module.exports = { prepareModelSelectorFixture }
