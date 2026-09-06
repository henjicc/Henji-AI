const CAMERA_STAGE_PLAYBACK_PROJECT_ID = 'ui-camera-stage-playback-clock'

function transform(x, y, z) {
  return {
    position: { x, y, z },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  }
}

function camera(id, name, fov) {
  return {
    id,
    type: 'camera',
    name,
    transform: transform(0, 1.5, 4),
    color: '#6da8ff',
    visible: true,
    fov,
    lookAt: { mode: 'manual', target: { x: 0, y: 0.9, z: 0 } },
    aspectRatio: { preset: '16:9', ratio: 16 / 9 },
    effectors: [],
  }
}

function objectState(object, position) {
  const state = {
    transform: { ...object.transform, position },
    color: object.color,
  }
  if (object.type === 'camera') {
    state.fov = object.fov
    state.lookAt = object.lookAt
  }
  if (object.type === 'character') {
    state.pose = object.pose
    state.motion = object.motion
  }
  return state
}

function createPlaybackFixture() {
  // 两个机位共用位置与lookAt，只用大幅FOV差异标识切换：
  // 若运行时没有在同一帧采样新机位，角色在WebGL画面中不会显著放大。
  const cameraA = camera('ui-clock-camera-a', '摄像机 A', 62)
  const cameraB = camera('ui-clock-camera-b', '摄像机 B', 26)
  const character = {
    id: 'ui-clock-character',
    type: 'character',
    name: '逐帧角色',
    transform: transform(-0.12, 0, 0),
    color: '#ef8354',
    visible: true,
    variant: 'standard',
    pose: { joints: {} },
    motion: { mode: 'pose' },
  }
  const objects = [cameraA, cameraB, character]
  const frame = (id, name, time, cameraId, characterX, transition) => ({
    id,
    name,
    time,
    continuity: 'stop',
    hold: 0,
    transitionDuration: Math.max(0, transition),
    cameraId,
    objectStates: Object.fromEntries(objects.map((object) => [
      object.id,
      objectState(
        object,
        object.id === character.id
          ? { x: characterX, y: 0, z: 0 }
          : object.transform.position,
      ),
    ])),
    transition: {
      perObject: id === 'ui-clock-frame-a'
        ? { [character.id]: { motionOverride: { mode: 'clip', clipName: 'Walk_Loop', speed: 3 } } }
        : {},
    },
  })
  return {
    schemaVersion: 14,
    objects,
    activeCameraId: cameraA.id,
    sceneSettings: {},
    stateKeyframes: [
      frame('ui-clock-frame-a', '动作开始', 0, cameraA.id, -0.12, 1),
      // 跨机位段采用 hold：角色根节点在 0~1 秒保持静止，像素变化只来自骨骼 clip。
      frame('ui-clock-frame-b', '切换机位', 1, cameraB.id, 0.12, 0.4),
      frame('ui-clock-frame-c', '循环边界', 1.4, cameraB.id, 0.12, 0),
    ],
  }
}

async function sampleCanvasFrames(pane, input) {
  return await pane.evaluate(async (root, options) => {
    const source = root.querySelector('canvas')
    if (!(source instanceof HTMLCanvasElement)) throw new Error('3D 镜头视口没有 WebGL canvas')
    const probe = document.createElement('canvas')
    probe.width = 160
    probe.height = 90
    const context = probe.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('无法创建逐帧像素探针')
    const frames = []
    const startedAt = performance.now()
    do {
      await new Promise((resolve) => requestAnimationFrame(resolve))
      context.drawImage(source, 0, 0, probe.width, probe.height)
      const pixels = context.getImageData(0, 0, probe.width, probe.height).data
      let hash = 2166136261
      let nonBlackPixels = 0
      let minimumLuma = 255
      let maximumLuma = 0
      let warmPixels = 0
      let warmX = 0
      let minimumWarmX = probe.width
      let minimumWarmY = probe.height
      let maximumWarmX = -1
      let maximumWarmY = -1
      const warmPoints = []
      for (let index = 0; index < pixels.length; index += 4) {
        const red = pixels[index]
        const green = pixels[index + 1]
        const blue = pixels[index + 2]
        const pixel = index / 4
        const x = pixel % probe.width
        const y = Math.floor(pixel / probe.width)
        const luma = Math.round(red * 0.299 + green * 0.587 + blue * 0.114)
        if (Math.max(red, green, blue) > 12) nonBlackPixels += 1
        minimumLuma = Math.min(minimumLuma, luma)
        maximumLuma = Math.max(maximumLuma, luma)
        if (red > 80 && red > green * 1.15 && green > blue * 1.05) {
          warmPixels += 1
          warmX += x
          minimumWarmX = Math.min(minimumWarmX, x)
          minimumWarmY = Math.min(minimumWarmY, y)
          maximumWarmX = Math.max(maximumWarmX, x)
          maximumWarmY = Math.max(maximumWarmY, y)
          warmPoints.push([x, y])
        }
        hash ^= red | (green << 8) | (blue << 16)
        hash = Math.imul(hash, 16777619)
      }
      // 把角色轮廓归一化到16×16再哈希，排除角色根节点平移；
      // 这使首18帧断言真正保护骨骼clip逐帧变形，而不是位置轨道。
      const normalizedShape = new Uint8Array(16 * 16)
      const warmWidth = Math.max(1, maximumWarmX - minimumWarmX + 1)
      const warmHeight = Math.max(1, maximumWarmY - minimumWarmY + 1)
      for (const [x, y] of warmPoints) {
        const normalizedX = Math.min(15, Math.floor((x - minimumWarmX) * 16 / warmWidth))
        const normalizedY = Math.min(15, Math.floor((y - minimumWarmY) * 16 / warmHeight))
        normalizedShape[normalizedY * 16 + normalizedX] = 1
      }
      let warmShapeHash = 2166136261
      for (const value of normalizedShape) {
        warmShapeHash ^= value
        warmShapeHash = Math.imul(warmShapeHash, 16777619)
      }
      frames.push({
        elapsedMs: performance.now() - startedAt,
        hash: hash >>> 0,
        nonBlackRatio: nonBlackPixels / (probe.width * probe.height),
        lumaRange: maximumLuma - minimumLuma,
        warmPixels,
        warmShapeHash: warmShapeHash >>> 0,
        warmCentroidX: warmPixels > 0 ? warmX / warmPixels / probe.width : null,
      })
    } while (frames.length < options.minimumFrames || performance.now() - startedAt < options.durationMs)
    return frames
  }, input)
}

function averageWarmSignature(frames) {
  const visible = frames.filter((frame) => frame.warmCentroidX !== null && frame.warmPixels > 1)
  if (visible.length === 0) return null
  return {
    count: visible.reduce((sum, frame) => sum + frame.warmPixels, 0) / visible.length,
    centroidX: visible.reduce((sum, frame) => sum + frame.warmCentroidX, 0) / visible.length,
  }
}

function assertReadableWebGlFrames(frames, phase) {
  const readable = frames.some((frame) => frame.nonBlackRatio > 0.25 && frame.lumaRange > 12)
  if (!readable) {
    throw new Error(`${phase} WebGL 像素读回为空，无法用 preserveDrawingBuffer 证明真实画面`)
  }
}

async function setupCameraStagePlaybackClock(page, context, inspection = {}) {
  const { setupToolbox, clickNamedButton, settlePage } = context
  await setupToolbox(page)
  const sceneJson = JSON.stringify(createPlaybackFixture())
  await page.evaluate(async ({ projectId, serialized }) => {
    const projects = window.henjiNative?.cameraStageProjects
    if (!projects) throw new Error('cameraStageProjects preload 不可用')
    const now = Date.now()
    await projects.upsertProjectRecord({
      id: projectId,
      name: '真实性巡检-统一逐帧时钟',
      createdAt: now,
      updatedAt: now,
      objectCount: 3,
      sceneJson: serialized,
    })
  }, { projectId: CAMERA_STAGE_PLAYBACK_PROJECT_ID, serialized: sceneJson })

  await clickNamedButton(page, /^(3D 镜头参考|3D Camera Reference)/i)
  const project = page.locator(`[data-project-id="${CAMERA_STAGE_PLAYBACK_PROJECT_ID}"]`)
  await project.waitFor({ state: 'visible', timeout: 12000 })
  await project.click()

  const pane = page.locator('[data-camera-stage-viewport-id="camera"]')
  await pane.waitFor({ state: 'visible', timeout: 12000 })
  await pane.click({ button: 'middle', position: { x: 320, y: 180 } })
  await settlePage(page, 1800)

  await page.locator('[title="循环播放"]:visible').click()
  await page.locator('[title="播放"]:visible').click()
  await page.locator('[title="暂停"]:visible').waitFor({ state: 'visible', timeout: 3000 })
  const frames = await sampleCanvasFrames(pane, { durationMs: 1900, minimumFrames: 90 })
  assertReadableWebGlFrames(frames, '播放中')

  const firstFrames = frames.slice(0, 18)
  const changedPairs = firstFrames.slice(1)
    .filter((frame, index) => frame.warmShapeHash !== firstFrames[index].warmShapeHash).length
  if (changedPairs < 10) {
    throw new Error(`角色骨骼没有保持逐帧更新：${changedPairs}/17 个相邻帧发生变化`)
  }

  const cameraAFrames = frames.filter((frame) => frame.elapsedMs < 350)
  const cameraBFrames = frames.filter((frame) => frame.elapsedMs >= 1050 && frame.elapsedMs <= 1250)
  const loopedCameraAFrames = frames.filter((frame) => frame.elapsedMs >= 1500 && frame.elapsedMs <= 1800)
  assertReadableWebGlFrames(cameraAFrames, '首机位')
  assertReadableWebGlFrames(cameraBFrames, '跨机位后')
  assertReadableWebGlFrames(loopedCameraAFrames, '循环回首机位后')
  const cameraA = averageWarmSignature(cameraAFrames)
  const cameraB = averageWarmSignature(cameraBFrames)
  const loopedCameraA = averageWarmSignature(loopedCameraAFrames)
  if (typeof inspection.capture === 'function') await inspection.capture('camera-transition')
  process.stdout.write(`  3D逐帧机位像素采样：${JSON.stringify({ cameraA, cameraB, loopedCameraA })}\n`)
  if (!cameraA || !cameraB || cameraB.count < cameraA.count * 1.8) {
    throw new Error(`1 秒跨机位没有反映到 WebGL 画面：${JSON.stringify({ cameraA, cameraB })}`)
  }
  if (!loopedCameraA
    || Math.abs(loopedCameraA.centroidX - cameraA.centroidX) > 0.07
    || loopedCameraA.count < cameraA.count * 0.5
    || loopedCameraA.count > cameraA.count * 1.8
    || cameraB.count < loopedCameraA.count * 1.8) {
    throw new Error(`1.4 秒循环后没有回到首机位画面：${JSON.stringify({ cameraA, loopedCameraA })}`)
  }

  await page.locator('[title="暂停"]:visible').click()
  await page.locator('[title="播放"]:visible').waitFor({ state: 'visible', timeout: 3000 })
  const pausedFrames = await sampleCanvasFrames(pane, { durationMs: 180, minimumFrames: 10 })
  const settledPausedFrames = pausedFrames.slice(2)
  assertReadableWebGlFrames(settledPausedFrames, '暂停后')
  if (new Set(settledPausedFrames.map((frame) => frame.hash)).size !== 1) {
    throw new Error('暂停后 WebGL 画面仍在逐帧变化')
  }
  await settlePage(page, 400)
}

module.exports = { setupCameraStagePlaybackClock }
