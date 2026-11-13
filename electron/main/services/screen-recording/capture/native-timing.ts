import fs from 'node:fs/promises'
import type { RecordingCombinedGroup } from '../../../../../src/core/screenRecording/combine'
import { captureFrameTimingFile } from '../../../../../src/core/screenRecording/capture'

/**
 * 原生画面采集进程写的逐帧时刻表（`<名字>.frames`，格式见 native/screen-capture/README.md）。
 * 一次录制一个画面文件、暂停不进文件：文件第 n 帧对应网格第 cell[n] 格，相邻两帧格号不连续处就是暂停。
 * 画面文件旁有这份时刻表，就说明它是这种“连续、已去掉暂停”的文件，时间换算以它为准。
 */
export interface CaptureTiming {
  fpsNum: number; fpsDen: number
  /** 网格起点（采集进程的单调时钟，微秒）。 */
  originUs: number
  /** 每帧所用来源帧的上屏时刻（采集进程时钟）、网格格号与标志。 */
  sourceUs: Float64Array; cell: Uint32Array; flags: Uint16Array
}
const MAGIC = 'HJFT'
export const TIMING_FRESH = 1
export const TIMING_DROPPED = 2
/** 这一帧之前的空档是来源丢失造成的（显示器断开、采集重新接上）：这段时间声音与事件没有停，不是暂停。 */
export const TIMING_AFTER_SOURCE_LOST = 16

/** 画面文件旁的时刻表文件名。与助手读回判断录法用的是同一个定义：恢复时另存的画面副本旁放的时刻表，读回时照样认得出。 */
export const captureTimingFile = captureFrameTimingFile

export function parseCaptureTiming(bytes: Buffer): CaptureTiming {
  if (bytes.length < 64 || bytes.toString('latin1', 0, 4) !== MAGIC) throw new Error('逐帧时刻表格式无效')
  // 只认识版本 1；更新的版本含义可能变了，不猜。
  const version = bytes.readUInt32LE(4)
  if (version !== 1) throw new Error(`逐帧时刻表是更新的版本（${version}）写的，请升级应用后再打开这次录制`)
  const headerBytes = bytes.readUInt32LE(8), recordBytes = bytes.readUInt32LE(12)
  if (headerBytes < 64 || recordBytes < 16 || bytes.length < headerBytes) throw new Error('逐帧时刻表格式无效')
  const fpsNum = bytes.readUInt32LE(16), fpsDen = bytes.readUInt32LE(20)
  if (!fpsNum || !fpsDen) throw new Error('逐帧时刻表帧率无效')
  // 进程被杀时尾部可能只写了半条：只取完整的记录。
  const count = Math.floor((bytes.length - headerBytes) / recordBytes)
  const sourceUs = new Float64Array(count), cell = new Uint32Array(count), flags = new Uint16Array(count)
  for (let index = 0, offset = headerBytes; index < count; index++, offset += recordBytes) {
    sourceUs[index] = Number(bytes.readBigInt64LE(offset)); cell[index] = bytes.readUInt32LE(offset + 8); flags[index] = bytes.readUInt16LE(offset + 12)
  }
  return { fpsNum, fpsDen, originUs: Number(bytes.readBigInt64LE(24)), sourceUs, cell, flags }
}
/** 画面文件没有时刻表（现有录法录的）时返回 null。 */
export async function readCaptureTiming(screenFile: string): Promise<CaptureTiming | null> {
  const bytes = await fs.readFile(captureTimingFile(screenFile)).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error })
  return bytes ? parseCaptureTiming(bytes) : null
}

const cellUs = (timing: Pick<CaptureTiming, 'fpsNum' | 'fpsDen'>, cells: number): number => cells * 1e6 * timing.fpsDen / timing.fpsNum

/** 连续录到的几段：从文件第 frame 帧起、网格第 cell 格起的 frames 帧。`frames` 限定只看文件里真有的前这么多帧（被杀后文件可能比时刻表短）。 */
export function captureTimingRuns(timing: CaptureTiming, frames = timing.cell.length): Array<{ frame: number; cell: number; frames: number; afterSourceLost: boolean }> {
  const runs: Array<{ frame: number; cell: number; frames: number; afterSourceLost: boolean }> = []
  const count = Math.min(frames, timing.cell.length)
  for (let index = 0; index < count; index++) {
    const last = runs.at(-1)
    if (last && timing.cell[index] === last.cell + last.frames) last.frames++
    else runs.push({ frame: index, cell: timing.cell[index], frames: 1, afterSourceLost: (timing.flags[index] & TIMING_AFTER_SOURCE_LOST) !== 0 })
  }
  return runs
}

/**
 * 画面相对网格的上屏偏移：新画面的上屏时刻减去它所在格的格时刻，取中位数（微秒，同一时钟里的差，与时钟校准无关）。没有新画面时为 0。
 * 每段的第一帧（文件第 0 帧、空档后的第一帧）不算：屏幕静止时它是开始前或空档中留下的旧画面，什么时候上屏与网格的相位无关。
 */
export function captureTimingLeadUs(timing: CaptureTiming): number {
  const values: number[] = []
  for (let index = 1; index < timing.cell.length; index++) {
    if (!(timing.flags[index] & TIMING_FRESH) || (timing.flags[index] & TIMING_DROPPED) || timing.cell[index] !== timing.cell[index - 1] + 1) continue
    values.push(timing.sourceUs[index] - timing.originUs - cellUs(timing, timing.cell[index]))
  }
  if (!values.length) return 0
  values.sort((a, b) => a - b)
  return Math.round(values[values.length >> 1])
}

/**
 * 文件第 0 帧显示的画面上屏的时刻（采集进程时钟）：它所在格的格时刻加上屏偏移。第 0 帧不一定在第 0 格——
 * 还没出第一帧就暂停过、或开始时来源正丢着，前面的格子都没进文件。画面内容还要早一个上屏提前量，由采集后端换算（见 native.ts）。
 */
export function captureTimingFirstFrameUs(timing: CaptureTiming): number {
  return Math.round(timing.originUs + cellUs(timing, timing.cell.length ? timing.cell[0] : 0) + captureTimingLeadUs(timing))
}

/**
 * 会话时钟上的暂停：第 0 帧在会话时钟 `firstFrameUs`，之后每段的起止按格号推出。
 * 与事件时钟扣掉的暂停（停在采集进程报的暂停那一格、从继续那一格接着走）、合并计划的各段是同一组数，三者处处对齐。
 */
export function captureTimingPauses(timing: CaptureTiming, firstFrameUs: number, frames?: number): Array<{ startUs: number; endUs: number }> {
  return captureTimingGaps(timing, firstFrameUs, frames).filter(gap => !gap.sourceLost).map(({ startUs, endUs }) => ({ startUs, endUs }))
}

/**
 * 文件里没有的全部时间段（会话时钟）：暂停，以及来源丢失的空档。画面条目的 gaps 用它（文件内位置要扣掉全部）；
 * 会话的暂停只取其中不是来源丢失的那些——来源丢失时声音与事件照常在走。
 */
export function captureTimingGaps(timing: CaptureTiming, firstFrameUs: number, frames?: number): Array<{ startUs: number; endUs: number; sourceLost: boolean }> {
  const runs = captureTimingRuns(timing, frames)
  if (!runs.length) return []
  const at = (cell: number): number => Math.round(firstFrameUs + cellUs(timing, cell - runs[0].cell))
  return runs.slice(1).map((run, index) => ({ startUs: at(runs[index].cell + runs[index].frames), endUs: at(run.cell), sourceLost: run.afterSourceLost }))
}

/**
 * 一个连续文件当作已合并好的一组：每段录到的画面是一片，都指向同一个文件，片在文件里首尾相接。
 * 只有一段（没暂停过）时不需要合并，返回 null，按普通单个文件导入。
 */
export function captureTimingGroup(mediaId: string, timing: CaptureTiming, firstFrameUs: number, frames?: number): RecordingCombinedGroup | null {
  const runs = captureTimingRuns(timing, frames)
  if (runs.length < 2) return null
  const fps = timing.fpsNum / timing.fpsDen
  return {
    fps, frames: runs.reduce((sum, run) => sum + run.frames, 0),
    parts: runs.map(run => ({ mediaId, monoUs: Math.round(firstFrameUs + cellUs(timing, run.cell - runs[0].cell)), frames: run.frames, fileUs: run.frame * 1e6 / fps })),
  }
}
