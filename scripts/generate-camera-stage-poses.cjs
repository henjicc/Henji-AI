/**
 * 从内置角色 GLB（resources/camera-stage/UAL1_Standard.glb）的动画片段中采样静态姿势，
 * 生成3D 镜头参考的预设姿势数据 src/features/cameraStage/domain/posePresets.gen.ts。
 *
 * 采样原理：直接解析 GLB 的 JSON/BIN chunk，读取指定片段在指定时间点上各受控骨骼的
 * 局部旋转四元数，与骨骼绑定姿态（rest）求差得到"相对绑定姿态的欧拉偏移（角度制，XYZ 序）"，
 * 与运行时渲染层 bone.quaternion = rest * offset 的应用方式互为逆运算。
 *
 * 运行：npm run gen:camera-stage-poses（预设片段/时间点调整后需重跑并提交生成文件）
 */
const fs = require('fs')
const path = require('path')

const GLB_PATH = path.join(__dirname, '..', 'resources', 'camera-stage', 'UAL1_Standard.glb')
const OUTPUT_PATH = path.join(__dirname, '..', 'src', 'features', 'cameraStage', 'domain', 'posePresets.gen.ts')

/** 受控关节 → GLB 骨骼名（须与 src/features/cameraStage/domain/poseTypes.ts 的 POSE_JOINT_BONES 一致） */
const JOINT_BONES = {
  body: 'pelvis',
  torso: 'spine_02',
  head: 'Head',
  shoulderL: 'upperarm_l',
  elbowL: 'lowerarm_l',
  wristL: 'hand_l',
  shoulderR: 'upperarm_r',
  elbowR: 'lowerarm_r',
  wristR: 'hand_r',
  hipL: 'thigh_l',
  kneeL: 'calf_l',
  ankleL: 'foot_l',
  hipR: 'thigh_r',
  kneeR: 'calf_r',
  ankleR: 'foot_r',
}

/** 预设清单：片段名 + 采样时间（片段时长的比例 0~1） */
const PRESET_SPECS = [
  { id: 'stand', zh: '站立', clip: 'Idle_Loop', frac: 0 },
  { id: 'talk', zh: '交谈', clip: 'Idle_Talking_Loop', frac: 0.3 },
  { id: 'walk', zh: '行走', clip: 'Walk_Loop', frac: 0.25 },
  { id: 'sit', zh: '坐姿', clip: 'Sitting_Idle_Loop', frac: 0 },
  { id: 'crouch', zh: '蹲伏', clip: 'Crouch_Idle_Loop', frac: 0 },
]

// ---------- GLB 解析 ----------

function parseGlb(filePath) {
  const buf = fs.readFileSync(filePath)
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('不是合法的 GLB 文件')
  const jsonLength = buf.readUInt32LE(12)
  const json = JSON.parse(buf.slice(20, 20 + jsonLength).toString('utf8'))
  const binStart = 20 + jsonLength + 8
  const bin = buf.slice(binStart)
  return { json, bin }
}

function readAccessor(json, bin, accessorIndex) {
  const accessor = json.accessors[accessorIndex]
  const view = json.bufferViews[accessor.bufferView]
  const byteOffset = (view.byteOffset || 0) + (accessor.byteOffset || 0)
  const componentCounts = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }
  const count = accessor.count * componentCounts[accessor.type]
  const out = new Float32Array(count)

  if (accessor.componentType === 5126) {
    for (let i = 0; i < count; i++) out[i] = bin.readFloatLE(byteOffset + i * 4)
  } else if (accessor.componentType === 5122) {
    // normalized short（glTF 动画输出常见压缩格式）
    for (let i = 0; i < count; i++) out[i] = Math.max(bin.readInt16LE(byteOffset + i * 2) / 32767, -1)
  } else if (accessor.componentType === 5121) {
    for (let i = 0; i < count; i++) out[i] = bin.readUInt8(byteOffset + i) / 255
  } else {
    throw new Error(`不支持的 componentType: ${accessor.componentType}`)
  }
  return out
}

// ---------- 四元数数学 ----------

function quatMultiply(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] + a[1] * b[3] + a[2] * b[0] - a[0] * b[2],
    a[3] * b[2] + a[2] * b[3] + a[0] * b[1] - a[1] * b[0],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ]
}

function quatConjugate(q) {
  return [-q[0], -q[1], -q[2], q[3]]
}

function quatSlerp(a, b, t) {
  let cosom = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
  const target = cosom < 0 ? b.map((v) => -v) : b
  if (cosom < 0) cosom = -cosom
  if (cosom > 0.9999) {
    return a.map((v, i) => v + t * (target[i] - v))
  }
  const omega = Math.acos(cosom)
  const sinom = Math.sin(omega)
  const wa = Math.sin((1 - t) * omega) / sinom
  const wb = Math.sin(t * omega) / sinom
  return a.map((v, i) => wa * v + wb * target[i])
}

function quatNormalize(q) {
  const len = Math.hypot(q[0], q[1], q[2], q[3]) || 1
  return q.map((v) => v / len)
}

/** 四元数 → XYZ 序欧拉角（角度制），与 three.js Euler 'XYZ' 一致 */
function quatToEulerXYZDeg(q) {
  const [x, y, z, w] = q
  const m11 = 1 - 2 * (y * y + z * z)
  const m12 = 2 * (x * y - w * z)
  const m13 = 2 * (x * z + w * y)
  const m22 = 1 - 2 * (x * x + z * z)
  const m23 = 2 * (y * z - w * x)
  const m32 = 2 * (y * z + w * x)
  const m33 = 1 - 2 * (x * x + y * y)

  const clamped = Math.min(Math.max(m13, -1), 1)
  const ey = Math.asin(clamped)
  let ex
  let ez
  if (Math.abs(clamped) < 0.9999999) {
    ex = Math.atan2(-m23, m33)
    ez = Math.atan2(-m12, m11)
  } else {
    ex = Math.atan2(m32, m22)
    ez = 0
  }
  const RAD2DEG = 180 / Math.PI
  return [ex * RAD2DEG, ey * RAD2DEG, ez * RAD2DEG]
}

// ---------- 动画采样 ----------

function findNodeIndexByName(json, name) {
  const index = json.nodes.findIndex((node) => node.name === name)
  if (index < 0) throw new Error(`GLB 中找不到骨骼节点: ${name}`)
  return index
}

/** 在指定片段中采样某节点某通道（rotation/translation）在时间 t 的值 */
function sampleChannel(json, bin, animation, nodeIndex, pathName, t) {
  const channel = animation.channels.find(
    (item) => item.target.node === nodeIndex && item.target.path === pathName,
  )
  if (!channel) return null

  const sampler = animation.samplers[channel.sampler]
  const times = readAccessor(json, bin, sampler.input)
  const values = readAccessor(json, bin, sampler.output)
  const stride = pathName === 'rotation' ? 4 : 3
  // CUBICSPLINE 输出为 [inTangent, value, outTangent] 三元组，取 value 段
  const cubic = sampler.interpolation === 'CUBICSPLINE'
  const readAt = (frame) => {
    const base = cubic ? (frame * 3 + 1) * stride : frame * stride
    return Array.from(values.slice(base, base + stride))
  }

  if (t <= times[0]) return readAt(0)
  if (t >= times[times.length - 1]) return readAt(times.length - 1)

  let frame = 0
  while (frame < times.length - 1 && times[frame + 1] < t) frame++
  const left = readAt(frame)
  if (cubic || sampler.interpolation === 'STEP') return left
  const right = readAt(frame + 1)
  const alpha = (t - times[frame]) / (times[frame + 1] - times[frame])
  if (pathName === 'rotation') return quatSlerp(left, right, alpha)
  return left.map((v, i) => v + alpha * (right[i] - v))
}

function clipDuration(json, bin, animation) {
  let max = 0
  for (const sampler of animation.samplers) {
    const times = readAccessor(json, bin, sampler.input)
    max = Math.max(max, times[times.length - 1])
  }
  return max
}

// ---------- 主流程 ----------

function round(value, digits) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function main() {
  const { json, bin } = parseGlb(GLB_PATH)
  const presets = []

  for (const spec of PRESET_SPECS) {
    const animation = (json.animations || []).find((item) => item.name === spec.clip)
    if (!animation) throw new Error(`GLB 中找不到动画片段: ${spec.clip}`)
    const t = clipDuration(json, bin, animation) * spec.frac

    const joints = {}
    for (const [jointId, boneName] of Object.entries(JOINT_BONES)) {
      const nodeIndex = findNodeIndexByName(json, boneName)
      const rest = json.nodes[nodeIndex].rotation || [0, 0, 0, 1]
      const sampled = sampleChannel(json, bin, animation, nodeIndex, 'rotation', t)
      if (!sampled) continue
      const offset = quatNormalize(quatMultiply(quatConjugate(quatNormalize(rest)), quatNormalize(sampled)))
      const [ex, ey, ez] = quatToEulerXYZDeg(offset)
      if (Math.abs(ex) < 0.05 && Math.abs(ey) < 0.05 && Math.abs(ez) < 0.05) continue
      joints[jointId] = { x: round(ex, 1), y: round(ey, 1), z: round(ez, 1) }
    }

    // 骨盆平移偏移（坐姿/蹲伏等需要整体降低身体，纯旋转表达不出来）
    const pelvisIndex = findNodeIndexByName(json, JOINT_BONES.body)
    const restPos = json.nodes[pelvisIndex].translation || [0, 0, 0]
    const sampledPos = sampleChannel(json, bin, animation, pelvisIndex, 'translation', t)
    let hipsOffset
    if (sampledPos) {
      const delta = sampledPos.map((v, i) => v - restPos[i])
      if (delta.some((v) => Math.abs(v) > 0.001)) {
        hipsOffset = { x: round(delta[0], 3), y: round(delta[1], 3), z: round(delta[2], 3) }
      }
    }

    presets.push({ id: spec.id, name: spec.zh, joints, ...(hipsOffset ? { hipsOffset } : {}) })
    console.log(`已采样预设「${spec.zh}」← ${spec.clip} @ ${round(t, 2)}s，关节数 ${Object.keys(joints).length}`)
  }

  const banner = [
    '/**',
    ' * 自动生成文件，禁止手改：npm run gen:camera-stage-poses（scripts/generate-camera-stage-poses.cjs）',
    ' * 数据来源：resources/camera-stage/UAL1_Standard.glb（Quaternius Universal Animation Library，CC0）',
    ' */',
    "import type { StagePosePreset } from './poseTypes'",
    '',
    `export const POSE_PRESETS: StagePosePreset[] = ${JSON.stringify(presets, null, 2)}`,
    '',
  ].join('\n')

  fs.writeFileSync(OUTPUT_PATH, banner, 'utf8')
  console.log(`已写入 ${path.relative(process.cwd(), OUTPUT_PATH)}`)
}

main()
