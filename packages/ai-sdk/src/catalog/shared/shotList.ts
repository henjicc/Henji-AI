/**
 * 分镜列表参数的值结构与校验：`[{ id?, prompt, duration }]`，按顺序成片，总时长等于各镜秒数之和。
 * 界面（生成面板与画布节点）共用同一个 `shot-list` 面板写入这个结构，请求构建只读这里。
 */

import type { JsonObject, JsonValue } from '../../types/runtime'

export interface ShotEntry {
  prompt: string
  duration: number
}

export interface ShotListLimits {
  /** 单镜提示词最多字符数 */
  maxPromptLength: number
  minShotSeconds: number
  maxShotSeconds: number
  /** 总时长范围，与不分镜时的时长参数一致 */
  minTotalSeconds: number
  maxTotalSeconds: number
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 读出分镜；不是数组或没有镜头时返回空数组，表示没有使用分镜。 */
export function readShots(value: JsonValue | undefined): ShotEntry[] {
  if (!Array.isArray(value)) return []
  return value.filter(isObject).map((shot) => ({
    prompt: typeof shot.prompt === 'string' ? shot.prompt.trim() : '',
    duration: Math.round(Number(shot.duration)),
  }))
}

/** 估价与界面汇总用：非法秒数按 0 计，结果夹在总时长范围内。 */
export function shotTotalSeconds(value: JsonValue | undefined, limits: Pick<ShotListLimits, 'minTotalSeconds' | 'maxTotalSeconds'>): number {
  const total = readShots(value).reduce((sum, shot) => sum + (Number.isFinite(shot.duration) && shot.duration > 0 ? shot.duration : 0), 0)
  return Math.min(limits.maxTotalSeconds, Math.max(limits.minTotalSeconds, total))
}

/** 提交前校验并转成供应商的 `multi_prompt` 结构；不合法时抛出能直接给用户看的原因。 */
export function buildShotPrompts(value: JsonValue | undefined, limits: ShotListLimits, modelName: string): Array<{ prompt: string; duration: number }> {
  const shots = readShots(value)
  shots.forEach((shot, index) => {
    const label = `${modelName} 第 ${index + 1} 镜`
    if (!shot.prompt) throw new Error(`${label}的提示词不能为空`)
    if (shot.prompt.length > limits.maxPromptLength) throw new Error(`${label}的提示词最多 ${limits.maxPromptLength} 字符`)
    if (!Number.isInteger(shot.duration) || shot.duration < limits.minShotSeconds || shot.duration > limits.maxShotSeconds) {
      throw new Error(`${label}的时长须为 ${limits.minShotSeconds}–${limits.maxShotSeconds} 秒`)
    }
  })
  const total = shots.reduce((sum, shot) => sum + shot.duration, 0)
  if (shots.length > 0 && (total < limits.minTotalSeconds || total > limits.maxTotalSeconds)) {
    throw new Error(`${modelName} 分镜总时长须为 ${limits.minTotalSeconds}–${limits.maxTotalSeconds} 秒，当前 ${total} 秒`)
  }
  return shots.map(({ prompt, duration }) => ({ prompt, duration }))
}
