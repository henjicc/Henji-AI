import { flushSync as flushStageRenderer } from '@react-three/fiber'
import { flushSync as flushDomRenderer } from 'react-dom'
import { readCameraStagePlaybackRuntime, seekCameraStagePlaybackRuntime } from './playbackRuntime'

/**
 * 把一次 store 改动同步提交到 DOM 与 three 两套 React 渲染器：返回时场景对象、真实摄像机和
 * 角色姿态都已落到新状态，可以立即离屏抓图。
 *
 * 导出逐帧走这里而不是等下一次 RAF：等帧会让四个窗格各自整屏重画一遍，场景一大导出就被拖慢，
 * 隐藏窗口里 RAF 还会被节流到约 1fps。只调 R3F 的 flushSync 不够：StageScene 在 DOM 渲染器里，
 * 它把新 props 交给 Canvas 时，R3F 那次更新默认排进异步任务，会晚于紧接着的抓图。
 */
export function commitCameraStageFrame(update: () => void): void {
  flushStageRenderer(() => {
    flushDomRenderer(update)
  })
  /*
   * 提交里的 effect 可能在真实相机落位之后再挪动它（摄像机视角的环绕控制器对齐目标时会
   * 重算相机位置）。平时由下一帧的帧回调重放权威机位，抓图不等帧，所以按当前时间重放一次。
   */
  const runtime = readCameraStagePlaybackRuntime()
  seekCameraStagePlaybackRuntime(runtime.time, runtime.playing)
}
