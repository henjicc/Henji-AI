/**
 * 从内置角色 GLB（resources/camera-stage/UAL1_Standard.glb）量出每个动作片段的时长，以及原地走跑片段的
 * 着地速度，生成 src/features/cameraStage/domain/characterClips.gen.ts。
 *
 * 着地速度：片段是原地动画（根骨骼不动），着地那只脚在模型空间里以身体前进的速度往后滑。
 * 取脚掌骨（ball）贴地的帧，逐帧差分它沿前方（+Z）的速度取中位数；播放时按“走过的路程 ÷ 着地速度”
 * 推进片段时间，脚就钉在地上（距离匹配）。左脚落地相位是左脚掌刚贴地的时刻占周期的比例，
 * 起步从这一相位进入，与待机姿势同样左脚在前、两脚着地。
 *
 * 运行：npm run gen:camera-stage-clips（换模型后重跑并提交生成文件）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const three = await import(pathToFileURL(path.join(root, 'node_modules/three/build/three.module.js')).href)
const { GLTFLoader } = await import(pathToFileURL(path.join(root, 'node_modules/three/examples/jsm/loaders/GLTFLoader.js')).href)

const GLB_PATH = path.join(root, 'resources', 'camera-stage', 'UAL1_Standard.glb')
const OUTPUT_PATH = path.join(root, 'src', 'features', 'cameraStage', 'domain', 'characterClips.gen.ts')
const LOCOMOTION_CLIPS = ['Walk_Loop', 'Walk_Formal_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Crouch_Fwd_Loop']
/** 没有 _Loop 后缀但本身就是循环待机的片段 */
const EXTRA_LOOPS = new Set(['Sword_Idle'])
const SAMPLES = 480
/** 脚掌离最低点不到这么高算贴地（米） */
const CONTACT_HEIGHT = 0.015
/** 着地程度从 1 降到 0 的离地高度范围（米），让腾空段的起止平滑 */
const CONTACT_BLEND = 0.04
/** 着地程度每个周期取多少个点 */
const CONTACT_SAMPLES = 48

const buffer = fs.readFileSync(GLB_PATH)
const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(
  buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '', resolve, reject,
))
const scene = gltf.scene
const bones = new Map()
scene.traverse((node) => { if (node.isBone) bones.set(node.name, node) })
const mixer = new three.AnimationMixer(scene)
const position = new three.Vector3()

const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits

function measureGait(clip) {
  mixer.stopAllAction()
  mixer.clipAction(clip).reset().play()
  const rows = []
  for (let index = 0; index <= SAMPLES; index += 1) {
    const time = (clip.duration * index) / SAMPLES
    mixer.setTime(time)
    scene.updateMatrixWorld(true)
    const row = { time }
    for (const side of ['l', 'r']) {
      bones.get(`ball_${side}`).getWorldPosition(position)
      row[side] = { y: position.y, z: position.z }
    }
    rows.push(row)
  }
  const speeds = []
  const strikes = {}
  for (const side of ['l', 'r']) {
    const floor = Math.min(...rows.map((row) => row[side].y))
    const grounded = (row) => row[side].y < floor + CONTACT_HEIGHT
    for (let index = 1; index < rows.length; index += 1) {
      if (grounded(rows[index]) && grounded(rows[index - 1])) {
        speeds.push(-(rows[index][side].z - rows[index - 1][side].z) / (rows[index].time - rows[index - 1].time))
      }
      if (strikes[side] === undefined && grounded(rows[index]) && !grounded(rows[index - 1])) strikes[side] = rows[index].time / clip.duration
    }
  }
  speeds.sort((a, b) => a - b)
  // 着地程度：每个取样点上贴地最紧的那只脚，离地 CONTACT_HEIGHT 以内算 1，再高 CONTACT_BLEND 降到 0。
  const floors = Object.fromEntries(['l', 'r'].map((side) => [side, Math.min(...rows.map((row) => row[side].y))]))
  const contactAt = (row) => Math.max(...['l', 'r'].map((side) => Math.max(0, Math.min(1, 1 - (row[side].y - floors[side] - CONTACT_HEIGHT) / CONTACT_BLEND))))
  const contact = Array.from({ length: CONTACT_SAMPLES }, (_, index) => round(contactAt(rows[Math.round((index * SAMPLES) / CONTACT_SAMPLES)]), 2))
  return {
    groundSpeed: round(speeds[Math.floor(speeds.length / 2)], 3),
    leftStrikePhase: round(strikes.l ?? 0, 3),
    // 走路总有一只脚着地，不需要；有腾空的跑步片段才记。
    ...(Math.min(...contact) < 0.5 ? { groundContact: contact } : {}),
  }
}

const facts = {}
for (const clip of gltf.animations) {
  const loop = clip.name.endsWith('_Loop') || EXTRA_LOOPS.has(clip.name)
  facts[clip.name] = {
    duration: round(clip.duration, 3),
    loop,
    ...(LOCOMOTION_CLIPS.includes(clip.name) ? measureGait(clip) : {}),
  }
  console.log(clip.name, JSON.stringify(facts[clip.name]))
}

const banner = [
  '/**',
  ' * 自动生成文件，禁止手改：npm run gen:camera-stage-clips（scripts/generate-camera-stage-clips.mjs）',
  ' * 数据来源：resources/camera-stage/UAL1_Standard.glb（Quaternius Universal Animation Library，CC0）',
  ' * duration 秒；loop 循环片段；groundSpeed 原地走跑片段按原速播放时对应的前进速度（米/秒，模型原尺寸）；',
  ' * leftStrikePhase 左脚掌刚着地的时刻占周期的比例；groundContact 有腾空的跑步片段把周期等分取样，',
  ' * 每点至少一只脚着地的程度（1 着地，0 腾空）。',
  ' */',
  'export interface CharacterClipFacts {',
  '  duration: number',
  '  loop: boolean',
  '  groundSpeed?: number',
  '  leftStrikePhase?: number',
  '  groundContact?: number[]',
  '}',
  '',
  `export const CHARACTER_CLIP_FACTS: Record<string, CharacterClipFacts> = ${JSON.stringify(facts, null, 2)}`,
  '',
].join('\n')
fs.writeFileSync(OUTPUT_PATH, banner, 'utf8')
console.log(`已写入 ${path.relative(process.cwd(), OUTPUT_PATH)}`)

/*
 * 挥手：动作库里没有，以待机为底生成右臂的关节曲线。大臂向外侧抬到与肩同高、略向前，小臂竖起；
 * 挥动时小臂绕肘在身体正面左右摆。骨骼朝向用“把骨骼从当前方向转到目标方向”的最小旋转求出
 * （两段骨各转一次），不扭转骨骼自身。抬手、挥三下、放下共 2.4 秒，前后与待机平滑过渡。
 */
const WAVE_DURATION = 2.4
const WAVE_FPS = 30
const RAISE = 0.45
const LOWER = 0.45
const WAVE_HZ = 2
const SWAY_DEGREES = 22
const idleClip = gltf.animations.find((clip) => clip.name === 'Idle_Loop')
mixer.stopAllAction()
mixer.clipAction(idleClip).reset().play()
const upper = bones.get('upperarm_r')
const lower = bones.get('lowerarm_r')
const hand = bones.get('hand_r')
const worldOf = (bone) => bone.getWorldPosition(new three.Vector3())

/** 把 bone 转到让 child 落在 target 方向上（世界坐标），返回新的局部旋转。 */
function aimBone(bone, child, target) {
  scene.updateMatrixWorld(true)
  const origin = worldOf(bone)
  const current = worldOf(child).sub(origin).normalize()
  const wanted = target.clone().sub(origin).normalize()
  const delta = new three.Quaternion().setFromUnitVectors(current, wanted)
  const worldRotation = bone.getWorldQuaternion(new three.Quaternion())
  const parentRotation = bone.parent.getWorldQuaternion(new three.Quaternion())
  bone.quaternion.copy(parentRotation.invert().multiply(delta.multiply(worldRotation)))
  scene.updateMatrixWorld(true)
  return bone.quaternion.clone()
}

const smooth = (x) => { const v = Math.max(0, Math.min(1, x)); return v * v * v * (10 + v * (-15 + 6 * v)) }
const keys = { upperarm_r: [], lowerarm_r: [] }
const times = []
for (let frame = 0; frame <= WAVE_DURATION * WAVE_FPS; frame += 1) {
  const time = frame / WAVE_FPS
  mixer.setTime(time % idleClip.duration)
  scene.updateMatrixWorld(true)
  const idleUpper = upper.quaternion.clone()
  const idleLower = lower.quaternion.clone()
  const shoulder = worldOf(upper)
  const upperLength = worldOf(lower).distanceTo(shoulder)
  const forearmLength = worldOf(hand).distanceTo(worldOf(lower))
  // 模型面朝 +Z，右手在 -X。
  const elbow = shoulder.clone().add(new three.Vector3(-0.93, 0.05, 0.35).normalize().multiplyScalar(upperLength))
  const waving = Math.max(0, Math.min(1, (time - RAISE) / (WAVE_DURATION - RAISE - LOWER)))
  const sway = (SWAY_DEGREES * Math.PI / 180) * Math.sin(2 * Math.PI * WAVE_HZ * waving * (WAVE_DURATION - RAISE - LOWER))
  const forearm = new three.Vector3(-Math.sin(sway) * 0.95, Math.cos(sway), 0.25).normalize().multiplyScalar(forearmLength)
  const raisedUpper = aimBone(upper, lower, elbow)
  const raisedLower = aimBone(lower, hand, elbow.clone().add(forearm))
  const weight = smooth(time / RAISE) * smooth((WAVE_DURATION - time) / LOWER)
  keys.upperarm_r.push(...idleUpper.clone().slerp(raisedUpper, weight).toArray().map((value) => round(value, 5)))
  keys.lowerarm_r.push(...idleLower.clone().slerp(raisedLower, weight).toArray().map((value) => round(value, 5)))
  times.push(round(time, 4))
}
const gestureBanner = [
  '/**',
  ' * 自动生成文件，禁止手改：npm run gen:camera-stage-clips（scripts/generate-camera-stage-clips.mjs）',
  ' * 挥手手势：以待机（Idle_Loop）为底，替换右臂两段骨骼的局部旋转（四元数 xyzw，按 times 逐帧）。',
  ' */',
  `export const WAVE_GESTURE = ${JSON.stringify({ duration: WAVE_DURATION, base: 'Idle_Loop', times, tracks: keys })}`,
  '',
].join('\n')
const GESTURE_PATH = path.join(root, 'src', 'features', 'cameraStage', 'domain', 'characterGestures.gen.ts')
fs.writeFileSync(GESTURE_PATH, gestureBanner, 'utf8')
console.log(`已写入 ${path.relative(process.cwd(), GESTURE_PATH)}`)
