/**
 * 3D 镜头参考关键帧插值引擎离线验证（node 直跑）。
 *
 * 用 esbuild 把纯逻辑内核（keyframeEngine + animationActions，无 React/three 依赖）打包成
 * 临时 ESM 后动态载入，覆盖：cubic-bezier 与独立参考实现对照、采样边界规则、乱序插入排序、
 * 颜色插值、轨道 upsert/move。任一断言失败即非零退出。
 *
 * 运行：node scripts/validate-camera-stage-keyframes.mjs
 */
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

let failures = 0
function assert(cond, message) {
  if (!cond) {
    failures += 1
    console.error(`  ✗ ${message}`)
  } else {
    console.log(`  ✓ ${message}`)
  }
}
function approx(a, b, eps = 1e-4) {
  return Math.abs(a - b) <= eps
}

/** 独立参考实现：cubic-bezier(x1,y1,x2,y2) 在 x 处的 y（密集采样求逆，作为对照真值） */
function referenceBezier(x1, y1, x2, y2, x) {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const bx = (t) => 3 * (1 - t) ** 2 * t * x1 + 3 * (1 - t) * t * t * x2 + t ** 3
  const by = (t) => 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t * t * y2 + t ** 3
  let lo = 0
  let hi = 1
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2
    if (bx(mid) < x) lo = mid
    else hi = mid
  }
  return by((lo + hi) / 2)
}

async function bundleModule(relEntry) {
  const outDir = await mkdtemp(join(tmpdir(), 'henji-kf-'))
  const outfile = join(outDir, 'bundle.mjs')
  await build({
    entryPoints: [join(ROOT, relEntry)],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
  })
  const mod = await import(pathToFileURL(outfile).href)
  return { mod, cleanup: () => rm(outDir, { recursive: true, force: true }) }
}

async function main() {
  const engine = await bundleModule('src/features/cameraStage/domain/keyframeEngine.ts')
  const actions = await bundleModule('src/features/cameraStage/store/animationActions.ts')
  const serialization = await bundleModule('src/features/cameraStage/domain/sceneSerialization.ts')
  const {
    cubicBezierEase,
    sampleTrack,
    interpolateValue,
    parseHexColor,
    upsertKeyframe,
    indexOfKeyframeAtTime,
  } = engine.mod
  const { upsertTrackKeyframe, moveTrackKeyframe, removeTrackKeyframe, getTrack } = actions.mod

  console.log('cubic-bezier 与参考实现对照:')
  const presets = [
    [0, 0, 1, 1],
    [0.42, 0, 1, 1],
    [0, 0, 0.58, 1],
    [0.42, 0, 0.58, 1],
    [0.25, 0.1, 0.25, 1],
  ]
  let maxErr = 0
  for (const [x1, y1, x2, y2] of presets) {
    for (let x = 0; x <= 1.0001; x += 0.05) {
      const got = cubicBezierEase(x1, y1, x2, y2, Math.min(1, x))
      const ref = referenceBezier(x1, y1, x2, y2, Math.min(1, x))
      maxErr = Math.max(maxErr, Math.abs(got - ref))
    }
  }
  assert(maxErr < 1e-3, `全预设最大误差 ${maxErr.toExponential(2)} < 1e-3`)
  assert(approx(cubicBezierEase(0, 0, 1, 1, 0.37), 0.37), 'linear 对角线恒等')

  console.log('标量采样边界规则:')
  const scalarTrack = {
    objectId: 'o',
    propertyPath: 'fov',
    keyframes: [
      { time: 1, value: 10, easing: 'linear' },
      { time: 3, value: 30, easing: 'linear' },
    ],
  }
  assert(sampleTrack(scalarTrack, 0, 'scalar') === 10, '首帧前取首值')
  assert(sampleTrack(scalarTrack, 5, 'scalar') === 30, '末帧后取末值')
  assert(approx(sampleTrack(scalarTrack, 2, 'scalar'), 20), '中点线性插值 = 20')
  assert(
    sampleTrack({ objectId: 'o', propertyPath: 'fov', keyframes: [{ time: 2, value: 7, easing: 'linear' }] }, 9, 'scalar') === 7,
    '单关键帧恒值',
  )
  assert(sampleTrack({ objectId: 'o', propertyPath: 'fov', keyframes: [] }, 0, 'scalar') === undefined, '空轨道返回 undefined')

  console.log('Vec3 与颜色插值:')
  const v = interpolateValue({ x: 0, y: 0, z: 0 }, { x: 2, y: 4, z: 8 }, 0.5, 'vec3')
  assert(v.x === 1 && v.y === 2 && v.z === 4, 'Vec3 逐分量插值')
  assert(parseHexColor('#fff').join(',') === '255,255,255', '#fff 解析为 255,255,255')
  assert(interpolateValue('#000000', '#ffffff', 0.5, 'color') === '#808080', '黑白中点 = #808080')
  assert(interpolateValue('#ff0000', '#0000ff', 0.5, 'color') === '#800080', '红蓝中点 = #800080')

  console.log('乱序插入排序与轨道操作:')
  let kfs = []
  for (const time of [2, 0, 3, 1]) {
    kfs = upsertKeyframe(kfs, { time, value: time * 10, easing: 'linear' })
  }
  assert(
    kfs.map((k) => k.time).join(',') === '0,1,2,3',
    `乱序插入后按 time 升序 (${kfs.map((k) => k.time).join(',')})`,
  )
  kfs = upsertKeyframe(kfs, { time: 2, value: 999, easing: 'linear' })
  assert(kfs.length === 4 && kfs[2].value === 999, '同点 upsert 替换值不新增')
  assert(indexOfKeyframeAtTime(kfs, 1) === 1 && indexOfKeyframeAtTime(kfs, 5) === -1, '同点查找容差正确')

  console.log('animation 层轨道增删移:')
  let animation = { tracks: [], duration: 5, fps: 30 }
  animation = upsertTrackKeyframe(animation, 'o', 'transform.position', 1, { x: 0, y: 0, z: 0 })
  animation = upsertTrackKeyframe(animation, 'o', 'transform.position', 3, { x: 6, y: 0, z: 0 })
  assert(getTrack(animation, 'o', 'transform.position').keyframes.length === 2, 'upsert 建轨并累积到 2 帧')
  animation = moveTrackKeyframe(animation, 'o', 'transform.position', 3, 4)
  const times = getTrack(animation, 'o', 'transform.position').keyframes.map((k) => k.time)
  assert(times.join(',') === '1,4', `move 后时间更新并保持有序 (${times.join(',')})`)
  animation = removeTrackKeyframe(animation, 'o', 'transform.position', 1)
  animation = removeTrackKeyframe(animation, 'o', 'transform.position', 4)
  assert(getTrack(animation, 'o', 'transform.position') === undefined, '删空关键帧后轨道自动移除')

  console.log('序列化版本迁移 v2→v3（整体 Vec3 轨道拆成分量轨道）:')
  const { deserializeScene } = serialization.mod
  const v2 = JSON.stringify({
    schemaVersion: 2,
    objects: [],
    activeCameraId: null,
    animation: {
      duration: 5,
      fps: 30,
      tracks: [
        {
          objectId: 'o',
          propertyPath: 'transform.position',
          keyframes: [
            { time: 0, value: { x: 1, y: 2, z: 3 }, easing: 'linear' },
            { time: 2, value: { x: 4, y: 5, z: 6 }, easing: 'easeIn' },
          ],
        },
        {
          objectId: 'o',
          propertyPath: 'fov',
          keyframes: [{ time: 0, value: 50, easing: 'linear' }],
        },
      ],
    },
  })
  const migrated = deserializeScene(v2)
  const paths = migrated.animation.tracks.map((t) => t.propertyPath).sort()
  assert(
    paths.join(',') === 'fov,transform.position.x,transform.position.y,transform.position.z',
    `Vec3 轨道拆成 3 分量、scalar 轨道保留 (${paths.join(',')})`,
  )
  const xTrack = migrated.animation.tracks.find((t) => t.propertyPath === 'transform.position.x')
  assert(
    xTrack.keyframes[0].value === 1 && xTrack.keyframes[1].value === 4 && xTrack.keyframes[1].easing === 'easeIn',
    'X 分量取标量值并保留各帧缓动',
  )
  const v1 = deserializeScene(JSON.stringify({ schemaVersion: 1, objects: [], activeCameraId: null }))
  assert(v1.animation.tracks.length === 0 && v1.schemaVersion === 3, 'v1 工程按无动画兼容、版本归一到 3')

  await engine.cleanup()
  await actions.cleanup()
  await serialization.cleanup()

  if (failures > 0) {
    console.error(`\n关键帧引擎验证失败：${failures} 项`)
    process.exit(1)
  }
  console.log('\n关键帧引擎验证全部通过 ✅')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
