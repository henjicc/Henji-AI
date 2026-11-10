/**
 * 多机位覆盖（纯数据，禁止 UI/three 依赖）。
 *
 * 一组覆盖 = 一段戏（谁、哪段时间、谁在什么时候说话）+ 为它布置的一套机位（建立、主镜头、过肩正反打、单人、
 * 反应、插入）。机位本身是普通摄像机对象，整条时间轴静止不动；这里只记每台摄像机在这组覆盖里担任什么镜头，
 * 剪辑时按角色挑镜头、按台词找说话人。剪辑结果写成机位切换点，不写在这里。
 */

import type { CameraStageCoverageRole } from '@/core/application-control/domains/cameraStage/cameraStageCoverageSchemas'
import type { StageObject, StageVec3 } from './sceneTypes'

type StageCoverageRole = CameraStageCoverageRole

export interface StageCoverageSetup {
  cameraId: string
  role: StageCoverageRole
  /** 被拍的人或物：建立与主镜头为全部主体，过肩为 [前景肩膀那人, 被拍者]，单人、反应、插入为一个 */
  subjectIds: string[]
  /** 插入镜头拍布景里的一个地点时的位置与高度（米） */
  point?: StageVec3
  height?: number
  /** 求机位时要的景别（与 compose_camera_stage_shot 的 size 同一套取值） */
  size: string
}

interface StageCoverageLine {
  speakerId: string
  startTime: number
  endTime: number
  text?: string
}

export interface StageCoverage {
  id: string
  name: string
  subjectIds: string[]
  startTime: number
  endTime: number
  /** 机位都在两人连线的哪一侧（与 axisSideOf 同一口径）；一个主体时为 null */
  axisSide: 1 | -1 | null
  lines: StageCoverageLine[]
  setups: StageCoverageSetup[]
}

function finite(value: unknown): number | null {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function vec3(value: unknown): StageVec3 | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const x = finite(record.x); const y = finite(record.y); const z = finite(record.z)
  return x === null || y === null || z === null ? undefined : { x, y, z }
}

const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : []

/** 宽松解析：结构不对的整条丢掉；不认识的镜头角色（更新版本新增的）原样保留，保存时不丢。 */
export function normalizeCoverages(raw: unknown): StageCoverage[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item): StageCoverage[] => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const startTime = finite(record.startTime)
    const endTime = finite(record.endTime)
    if (typeof record.id !== 'string' || !record.id || startTime === null || endTime === null || endTime < startTime) return []
    const setups = Array.isArray(record.setups) ? record.setups.flatMap((raw): StageCoverageSetup[] => {
      if (!raw || typeof raw !== 'object') return []
      const setup = raw as Record<string, unknown>
      if (typeof setup.cameraId !== 'string' || !setup.cameraId || typeof setup.role !== 'string' || typeof setup.size !== 'string') return []
      const point = vec3(setup.point)
      const height = finite(setup.height)
      return [{
        ...setup,
        cameraId: setup.cameraId,
        role: setup.role as StageCoverageRole,
        subjectIds: strings(setup.subjectIds),
        size: setup.size,
        ...(point ? { point } : {}),
        ...(height !== null && height > 0 ? { height } : {}),
      }]
    }) : []
    const lines = Array.isArray(record.lines) ? record.lines.flatMap((raw): StageCoverageLine[] => {
      if (!raw || typeof raw !== 'object') return []
      const line = raw as Record<string, unknown>
      const start = finite(line.startTime)
      const end = finite(line.endTime)
      if (typeof line.speakerId !== 'string' || !line.speakerId || start === null || end === null || end <= start) return []
      return [{ speakerId: line.speakerId, startTime: start, endTime: end, ...(typeof line.text === 'string' && line.text ? { text: line.text } : {}) }]
    }).sort((left, right) => left.startTime - right.startTime) : []
    return [{
      ...record,
      id: record.id,
      name: typeof record.name === 'string' ? record.name : '覆盖',
      subjectIds: strings(record.subjectIds),
      startTime,
      endTime,
      axisSide: record.axisSide === 1 || record.axisSide === -1 ? record.axisSide : null,
      lines,
      setups,
    }]
  })
}

/** 还在的覆盖：机位已被删掉的镜头去掉，镜头删光的整组去掉。 */
export function liveCoverages(coverages: readonly StageCoverage[], objects: readonly StageObject[]): StageCoverage[] {
  const cameras = new Set(objects.filter((object) => object.type === 'camera').map((object) => object.id))
  return coverages.flatMap((coverage) => {
    if (coverage.setups.every((setup) => cameras.has(setup.cameraId))) return [coverage]
    const setups = coverage.setups.filter((setup) => cameras.has(setup.cameraId))
    return setups.length > 0 ? [{ ...coverage, setups }] : []
  })
}
