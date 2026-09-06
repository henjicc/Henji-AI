export type CameraStagePlaybackRuntimeReason = 'frame' | 'seek' | 'pause' | 'reset'

export interface CameraStagePlaybackRuntimeSnapshot {
  time: number
  playing: boolean
  reason: CameraStagePlaybackRuntimeReason
  wrapped: boolean
  reachedEnd: boolean
  sequence: number
}

export interface CameraStagePlaybackAdvanceResult extends CameraStagePlaybackRuntimeSnapshot {
  accepted: boolean
}

type PlaybackRuntimeListener = (snapshot: CameraStagePlaybackRuntimeSnapshot) => void

const listeners = new Set<PlaybackRuntimeListener>()
let activeDriver: symbol | null = null
let sessionKey: string | null = null
const driverSessions = new Map<symbol, string | null>()
let snapshot: CameraStagePlaybackRuntimeSnapshot = {
  time: 0,
  playing: false,
  reason: 'reset',
  wrapped: false,
  reachedEnd: false,
  sequence: 0,
}

function safeTime(time: number): number {
  return Number.isFinite(time) ? Math.max(0, time) : 0
}

function publish(
  time: number,
  playing: boolean,
  reason: CameraStagePlaybackRuntimeReason,
  options: { wrapped?: boolean; reachedEnd?: boolean } = {},
): CameraStagePlaybackRuntimeSnapshot {
  snapshot = {
    time: safeTime(time),
    playing,
    reason,
    wrapped: options.wrapped === true,
    reachedEnd: options.reachedEnd === true,
    sequence: snapshot.sequence + 1,
  }
  for (const listener of listeners) listener(snapshot)
  return snapshot
}

/**
 * 一个 renderer 会话只允许 primary StageScene 推进时间；四视口中的其余 Canvas 只消费。
 * 同工程切换 primary 时保留精确运行时时间，切工程则以新工程 store 播放头重置。
 */
export function claimCameraStagePlaybackDriver(input: {
  sessionKey: string | null
  time: number
  playing: boolean
}): symbol {
  const token = Symbol('camera-stage-playback-driver')
  driverSessions.clear()
  activeDriver = token
  driverSessions.set(token, input.sessionKey)
  if (sessionKey !== input.sessionKey) {
    sessionKey = input.sessionKey
    publish(input.time, input.playing, 'reset')
  } else if (!input.playing) {
    publish(input.time, false, 'reset')
  } else if (!snapshot.playing) {
    publish(input.time, true, 'seek')
  }
  return token
}

export function releaseCameraStagePlaybackDriver(token: symbol): void {
  if (activeDriver === token) activeDriver = null
  driverSessions.delete(token)
}

/**
 * 同一工程在已挂载 Canvas 内重载时，store 会先让租约失效；原 primary driver 可在下一帧
 * 重新认领。token 的原始工程和当前 runtime 工程必须同时匹配，旧工程 driver 不能越界复活。
 */
export function resumeCameraStagePlaybackDriver(
  token: symbol,
  expectedSessionKey: string | null,
): boolean {
  if (activeDriver === token) return true
  if (
    activeDriver !== null
    || sessionKey !== expectedSessionKey
    || driverSessions.get(token) !== expectedSessionKey
  ) return false
  activeDriver = token
  return true
}

export function resetCameraStagePlaybackRuntime(time = 0, nextSessionKey: string | null = null): void {
  // 工程真相源已切换时先让旧 Canvas 的 driver 租约失效，等新 primary 明确重新 claim。
  activeDriver = null
  sessionKey = nextSessionKey
  publish(time, false, 'reset')
}

export function seekCameraStagePlaybackRuntime(time: number, playing = snapshot.playing): void {
  publish(time, playing, 'seek')
}

export function pauseCameraStagePlaybackRuntime(time: number): void {
  publish(time, false, 'pause')
}

export function advanceCameraStagePlaybackRuntime(input: {
  driver: symbol
  delta: number
  duration: number
  loop: boolean
}): CameraStagePlaybackAdvanceResult {
  if (input.driver !== activeDriver) return { ...snapshot, accepted: false }

  const duration = safeTime(input.duration)
  const delta = safeTime(input.delta)
  let time = snapshot.time + delta
  let wrapped = false
  let reachedEnd = false
  if (time >= duration) {
    if (input.loop && duration > 0) {
      time %= duration
      wrapped = true
    } else {
      time = duration
      reachedEnd = true
    }
  }
  return {
    ...publish(time, !reachedEnd, 'frame', { wrapped, reachedEnd }),
    accepted: true,
  }
}

export function readCameraStagePlaybackRuntime(): CameraStagePlaybackRuntimeSnapshot {
  return snapshot
}

export function subscribeCameraStagePlaybackRuntime(listener: PlaybackRuntimeListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 仅供隔离单元测试，生产代码不得批量清理监听器。 */
export function resetCameraStagePlaybackRuntimeForTest(): void {
  listeners.clear()
  activeDriver = null
  sessionKey = null
  driverSessions.clear()
  snapshot = { time: 0, playing: false, reason: 'reset', wrapped: false, reachedEnd: false, sequence: 0 }
}
