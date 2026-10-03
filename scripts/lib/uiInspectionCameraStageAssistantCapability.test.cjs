const assert = require('node:assert/strict')
const test = require('node:test')

const {
  executeCapability,
  requireCancellationRequested,
  requireCompletedTask,
  requirePersistedCreatedProject,
  requireSubmittedTask,
  requireVideoReadyCameraStageProject,
  resolveCancelledTaskEvent,
} = require('./uiInspectionCameraStageAssistantCapability.cjs')
const {
  createCameraStagePlaybackScenes,
} = require('./uiInspectionSceneCatalogCameraStagePlayback.cjs')

function fakeClient(responses) {
  const calls = []
  return {
    calls,
    callTool: async ({ name, arguments: args }) => {
      calls.push({ name, args })
      return { isError: false, structuredContent: responses[name] }
    },
  }
}

test('能力经正式 MCP 入口调用：读取原样返回，写入带操作信封并投影回 { ok, data }', async () => {
  const taskRef = { kind: 'camera_stage.render_task', id: 'task-1' }
  const client = fakeClient({
    get_camera_stage_render_task: { ok: true, data: { status: 'running', resultRefs: [] }, baselineId: 'b-1' },
    cancel_camera_stage_render_task: { ok: true, executionState: 'completed',
      result: { ok: true, data: { status: 'cancellation_requested', resultRefs: [] } } },
  })
  const read = await executeCapability(client, { id: 'get_camera_stage_render_task', input: { taskRef } })
  assert.equal(read.data.status, 'running')
  assert.deepEqual(client.calls[0].args, { taskRef })
  const cancelled = await executeCapability(client, { id: 'cancel_camera_stage_render_task', input: { taskRef } }, [read])
  assert.equal(requireCancellationRequested(cancelled).status, 'cancellation_requested')
  const envelope = client.calls[1].args
  assert.match(envelope.operationId, /^[0-9a-f-]{36}$/)
  assert.deepEqual(envelope.baselineIds, ['b-1'])
  assert.deepEqual(envelope.taskRef, taskRef)
})

test('MCP 调用失败不得被当成通过', async () => {
  const client = { callTool: async () => ({ isError: true, structuredContent: { ok: false } }) }
  await assert.rejects(executeCapability(client, { id: 'create_camera_stage_project', input: { name: 'x' } }), /调用失败/)
})

test('Camera Stage 正式目录注册助手后台输出能力场景', () => {
  const scenes = createCameraStagePlaybackScenes({})
  const scene = scenes.find((candidate) => candidate.id === 'canvas-camera-stage-assistant-render-capability')
  assert.equal(scene?.writesUserData, true)
  assert.equal(typeof scene?.setup, 'function')
})

test('场景只接受稳定 submitted、持久 completed 与活动取消回执', () => {
  const taskRef = { kind: 'camera_stage.render_task', id: 'task-1' }
  assert.equal(requireSubmittedTask({
    ok: true, data: { status: 'submitted', taskRef, resultRefs: [taskRef] },
  }, 'render_camera_stage_output').taskRef, taskRef)
  assert.equal(requireCompletedTask({
    status: 'completed', resultRefs: [{ kind: 'canvas.node', id: 'canvas-1:result-1' }],
  }, 'canvas-1').status, 'completed')
  assert.equal(requireCancellationRequested({
    ok: true, data: { status: 'cancellation_requested', resultRefs: [] },
  }).status, 'cancellation_requested')

  assert.throws(() => requireSubmittedTask({
    ok: true, data: { status: 'completed', taskRef, resultRefs: [] },
  }, 'render_camera_stage_output'), /稳定已提交任务/)
  assert.throws(() => requireCompletedTask({
    status: 'completed', resultRefs: [{ kind: 'canvas.node', id: 'other:result-1' }],
  }, 'canvas-1'), /唯一持久结果节点/)
  assert.throws(() => requireCancellationRequested({
    ok: true, data: { status: 'completed', resultRefs: [{ kind: 'canvas.node', id: 'canvas-1:video' }] },
  }), /没有接受取消/)
})

test('后台创建必须落盘默认相机和零秒关键帧并与稳定引用一致', () => {
  const created = {
    projectId: 'camera-project-1',
    name: '后台工程',
    defaultCameraId: 'camera-1',
    defaultStateKeyframeId: 'state-1',
    resultRefs: [
      { kind: 'camera_stage.project', id: 'camera-project-1' },
      { kind: 'camera_stage.camera', id: 'camera-project-1:camera-1' },
      { kind: 'camera_stage.state_keyframe', id: 'camera-project-1:state-1' },
    ],
  }
  const record = {
    id: 'camera-project-1',
    name: '后台工程',
    objectCount: 1,
    sceneJson: JSON.stringify({
      activeCameraId: 'camera-1',
      objects: [{ id: 'camera-1', type: 'camera' }],
      stateKeyframes: [{ id: 'state-1', time: 0, cameraId: 'camera-1' }],
    }),
  }
  assert.deepEqual(requirePersistedCreatedProject(created, record), {
    cameraId: 'camera-1', stateKeyframeId: 'state-1',
  })
  assert.throws(() => requirePersistedCreatedProject(created, {
    ...record,
    sceneJson: JSON.stringify({
      activeCameraId: 'other-camera',
      objects: [{ id: 'camera-1', type: 'camera' }],
      stateKeyframes: [{ id: 'state-1', time: 0, cameraId: 'camera-1' }],
    }),
  }), /默认相机、关键帧或稳定引用不一致/)
})

test('视频取消场景只接受正式运镜后持久化的第二个状态关键帧', () => {
  const created = {
    projectId: 'camera-project-1',
    defaultCameraId: 'camera-1',
    defaultStateKeyframeId: 'state-1',
  }
  const record = {
    id: 'camera-project-1',
    sceneJson: JSON.stringify({
      activeCameraId: 'camera-1',
      objects: [{ id: 'camera-1', type: 'camera' }],
      stateKeyframes: [
        { id: 'state-1', time: 0, cameraId: 'camera-1' },
        { id: 'state-2', time: 2, cameraId: 'camera-1' },
      ],
    }),
  }
  assert.equal(requireVideoReadyCameraStageProject(created, record), 2)
  assert.throws(() => requireVideoReadyCameraStageProject(created, {
    ...record,
    sceneJson: JSON.stringify({
      activeCameraId: 'camera-1',
      objects: [{ id: 'camera-1', type: 'camera' }],
      stateKeyframes: [{ id: 'state-1', time: 0, cameraId: 'camera-1' }],
    }),
  }), /第二个状态关键帧/)
})

test('取消证据只接受同一请求的 cancelled 正式终态事件', () => {
  const events = [
    { requestId: 'other', status: 'cancelled' },
    { requestId: 'video-1', status: 'running' },
    { requestId: 'video-1', status: 'cancelled' },
  ]
  assert.equal(resolveCancelledTaskEvent(events, 'video-1')?.status, 'cancelled')
  assert.equal(resolveCancelledTaskEvent(events, 'missing'), null)
  assert.throws(() => resolveCancelledTaskEvent([
    { requestId: 'video-1', status: 'completed' },
  ], 'video-1'), /意外进入 completed/)
  assert.throws(() => resolveCancelledTaskEvent([
    { requestId: 'video-1', status: 'failed' },
  ], 'video-1'), /意外进入 failed/)
})
