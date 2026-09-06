const { createPlaybackFixture } = require('./uiInspectionCameraStagePlayback.cjs')

const CAMERA_STAGE_BACKGROUND_PROJECT_ID = 'ui-camera-stage-background-render'
const CAMERA_STAGE_NODE_ID = '__ui_camera_stage_background'

async function setupCameraStageBackgroundRender(page, context, inspection = {}) {
  const { seedAndOpenCanvasPanoramaProject, settlePage } = context
  await page.evaluate(async ({ stageProjectId, sceneJson }) => {
    const now = Date.now()
    await window.henjiNative.cameraStageProjects.upsertProjectRecord({
      id: stageProjectId,
      name: '真实性巡检-后台渲染生命周期',
      createdAt: now,
      updatedAt: now,
      objectCount: 3,
      sceneJson,
    })
  }, {
    stageProjectId: CAMERA_STAGE_BACKGROUND_PROJECT_ID,
    sceneJson: JSON.stringify(createPlaybackFixture()),
  })

  const { projectId } = await seedAndOpenCanvasPanoramaProject(page)
  await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click()
  await settlePage(page, 500)
  const node = {
    id: CAMERA_STAGE_NODE_ID,
    type: 'cameraStageNode',
    position: { x: 220, y: 160 },
    width: 480,
    height: 320,
    measured: { width: 480, height: 320 },
    style: { width: 480, height: 320 },
    data: {
      displayName: '后台渲染镜头',
      projectId: CAMERA_STAGE_BACKGROUND_PROJECT_ID,
      imageUrl: null,
      previewImageUrl: null,
      videoUrl: null,
      aspectRatio: '16:9',
      durationSec: null,
      selectedTimeSec: 0.25,
      mediaInputs: {},
      environmentImageUrl: null,
      imageExporting: false,
      imageRenderRequestId: null,
      imageRenderError: null,
      videoProgress: null,
      videoExporting: false,
      videoRenderPhase: null,
      videoRenderRequestId: null,
      videoRenderError: null,
      renderTask: null,
      outputKind: 'image',
    },
  }
  await page.evaluate(async ({ canvasProjectId, cameraNode }) => {
    await window.henjiNative.db.execute(
      'UPDATE storyboard_projects SET node_count = 1, nodes_json = ?, edges_json = ?, viewport_json = ?, history_json = ? WHERE id = ?',
      [JSON.stringify([cameraNode]), '[]', JSON.stringify({ x: 180, y: 100, zoom: 0.8 }),
        JSON.stringify({ past: [], future: [], imagePool: [] }), canvasProjectId]
    )
  }, { canvasProjectId: projectId, cameraNode: node })

  const projectCard = page.locator(`[data-project-id="${projectId}"]:visible`)
  await projectCard.click()
  const cameraNode = page.locator(`.react-flow__node[data-id="${CAMERA_STAGE_NODE_ID}"]`)
  await cameraNode.waitFor({ state: 'visible', timeout: 12000 })
  await cameraNode.click()
  await page.getByRole('button', { name: /输出图片|Output Image/i }).click()

  await page.waitForFunction(async ({ canvasProjectId, nodeId }) => {
    const rows = await window.henjiNative.db.select(
      'SELECT nodes_json FROM storyboard_projects WHERE id = ? LIMIT 1', [canvasProjectId]
    )
    const nodes = rows.length ? JSON.parse(rows[0].nodes_json) : []
    const source = nodes.find((candidate) => candidate.id === nodeId)
    return Boolean(source?.data?.renderTask?.requestId)
  }, { canvasProjectId: projectId, nodeId: CAMERA_STAGE_NODE_ID }, { timeout: 12000 })

  // 返回工程列表会卸载整个 Canvas（包括旧实现所在的 CameraStageNodeDialog），
  // 应用级任务宿主仍保持订阅；终态先留在主进程，等重入工程后再落图。
  await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click()
  await page.waitForFunction(async (canvasProjectId) => {
    const tasks = await window.henjiNative.cameraStageRender.list(canvasProjectId)
    return tasks.some((task) => task.status === 'completed')
  }, projectId, { timeout: 45000 })

  const beforeRows = await page.evaluate(async (canvasProjectId) => (
    await window.henjiNative.db.select(
      'SELECT nodes_json FROM storyboard_projects WHERE id = ? LIMIT 1', [canvasProjectId]
    )
  ), projectId)
  if (JSON.parse(beforeRows[0].nodes_json).length !== 1) {
    throw new Error('离开画布期间不应绕过宿主持久化屏障直接新增结果节点')
  }

  await projectCard.click()
  await page.waitForFunction(async ({ canvasProjectId, nodeId }) => {
    const rows = await window.henjiNative.db.select(
      'SELECT nodes_json FROM storyboard_projects WHERE id = ? LIMIT 1', [canvasProjectId]
    )
    const nodes = rows.length ? JSON.parse(rows[0].nodes_json) : []
    const source = nodes.find((candidate) => candidate.id === nodeId)
    return nodes.filter((candidate) => candidate.type === 'exportImageNode').length === 1
      && source?.data?.renderTask == null
      && source?.data?.imageExporting === false
  }, { canvasProjectId: projectId, nodeId: CAMERA_STAGE_NODE_ID }, { timeout: 20000 })
  await page.locator('.react-flow__node').nth(1).waitFor({ state: 'visible', timeout: 12000 })
  const remaining = await page.evaluate(async (canvasProjectId) => (
    await window.henjiNative.cameraStageRender.list(canvasProjectId)
  ), projectId)
  if (remaining.length !== 0) throw new Error('持久化确认后 3D 后台渲染终态没有 ack')
  if (typeof inspection.capture === 'function') await inspection.capture('background-render-reentered')
}

module.exports = { setupCameraStageBackgroundRender }
