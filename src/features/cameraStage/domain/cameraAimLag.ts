/**
 * 注视跟随滞后（纯函数）：镜头朝向像摄影师一样略慢半拍地跟着理想朝向走。
 *
 * 模型是临界阻尼二阶系统 x″ = ω²(g − x) − 2ωx′，对理想朝向的单位向量逐分量滤波后再归一化：
 * 不超调、不来回晃，匀速摇镜时稳定落后 2/ω 秒，所以 ω = 2/滞后时间。按向量滤波而不是按欧拉角，
 * 跨 ±180° 时不需要解包。
 *
 * 确定性：从时间轴起点按固定步长（与播放、导出帧率无关）预先积分一遍，网格点之间把输入当成线性，
 * 用临界阻尼方程的解析解推到任意时刻。播放、拖动时间轴、离屏导出在同一时刻拿到的值完全相同，
 * 且结果对时间连续（朝向的角速度连续）。
 */

import type { StageVec3 } from './sceneTypes'

export type AimLagSampler = (time: number) => StageVec3

/** 网格步长只影响“输入在步内按线性近似”的精度，不影响确定性。 */
const LAG_GRID_STEP = 1 / 60
/** 理想朝向在一步里转过这么多（注视目标跳位等未登记的跳变）也直接对齐。 */
const RESET_ANGLE = 20 * Math.PI / 180

interface FilterState {
  position: StageVec3
  velocity: StageVec3
}

function lerp(a: StageVec3, b: StageVec3, t: number): StageVec3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }
}

function normalize(value: StageVec3): StageVec3 {
  const length = Math.hypot(value.x, value.y, value.z)
  return length <= 1e-12 ? { ...value } : { x: value.x / length, y: value.y / length, z: value.z / length }
}

function angleBetween(a: StageVec3, b: StageVec3): number {
  const dot = (a.x * b.x + a.y * b.y + a.z * b.z) / Math.max(1e-12, Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z))
  return Math.acos(Math.max(-1, Math.min(1, dot)))
}

/**
 * 输入在 [0, duration] 内从 from 线性变到 to 时，把状态推进 elapsed 秒（解析解）。
 * 令 e = x − g，则 e″ + 2ωe′ + ω²e = −2ωc（c 为输入斜率），特解 −2c/ω，齐次解 (A + Bτ)e^(−ωτ)。
 */
function propagate(state: FilterState, from: StageVec3, to: StageVec3, duration: number, elapsed: number, omega: number): FilterState {
  const decay = Math.exp(-omega * elapsed)
  const axis = (key: keyof StageVec3): [number, number] => {
    const slope = duration > 0 ? (to[key] - from[key]) / duration : 0
    const particular = -2 * slope / omega
    const a = state.position[key] - from[key] - particular
    const b = state.velocity[key] - slope + omega * a
    const input = from[key] + slope * elapsed
    return [
      input + particular + (a + b * elapsed) * decay,
      slope + (b - omega * (a + b * elapsed)) * decay,
    ]
  }
  const [px, vx] = axis('x')
  const [py, vy] = axis('y')
  const [pz, vz] = axis('z')
  return { position: { x: px, y: py, z: pz }, velocity: { x: vx, y: vy, z: vz } }
}

/**
 * idealDirection(t) 给出不滞后时的朝向（单位向量）。start 之前不滞后；end 之后输入保持 end 时的值，镜头继续收敛。
 * jumpTimes 是已知的跳变时刻（硬切）：所在的那一步直接对齐，不论转角大小。
 */
export function createAimLagSampler(
  delay: number,
  start: number,
  end: number,
  idealDirection: (time: number) => StageVec3,
  jumpTimes: readonly number[] = [],
): AimLagSampler {
  const omega = 2 / delay
  const count = Math.max(1, Math.ceil((end - start) / LAG_GRID_STEP))
  const step = (end - start) / count
  const inputs = Array.from({ length: count + 1 }, (_, index) => normalize(idealDirection(start + index * step)))
  const states: FilterState[] = [{
    position: inputs[0],
    velocity: count > 0 && step > 0 ? {
      x: (inputs[1].x - inputs[0].x) / step,
      y: (inputs[1].y - inputs[0].y) / step,
      z: (inputs[1].z - inputs[0].z) / step,
    } : { x: 0, y: 0, z: 0 },
  }]
  const resets = new Set<number>()
  for (const time of jumpTimes) {
    if (time > start && time <= end) resets.add(Math.min(count - 1, Math.max(0, Math.ceil((time - start) / step) - 1)))
  }
  for (let index = 0; index < count; index += 1) {
    if (resets.has(index) || angleBetween(inputs[index], inputs[index + 1]) > RESET_ANGLE) {
      resets.add(index)
      states.push({ position: inputs[index + 1], velocity: { x: 0, y: 0, z: 0 } })
      continue
    }
    states.push(propagate(states[index], inputs[index], inputs[index + 1], step, step, omega))
  }

  return (time) => {
    if (time < start || step <= 0) return normalize(idealDirection(time))
    if (time >= end) {
      const settled = propagate(states[count], inputs[count], inputs[count], 0, time - end, omega)
      return normalize(settled.position)
    }
    const index = Math.min(count - 1, Math.floor((time - start) / step))
    const elapsed = time - (start + index * step)
    // 跳变所在的这一步不滤波，免得在跳变前半步就开始甩。
    if (resets.has(index)) return normalize(lerp(inputs[index], inputs[index + 1], elapsed / step))
    return normalize(propagate(states[index], inputs[index], inputs[index + 1], step, elapsed, omega).position)
  }
}
