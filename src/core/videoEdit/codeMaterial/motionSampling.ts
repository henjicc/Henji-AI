import type { CodeMatrix } from './contract'
import type { VideoEditFrameOffset, VideoEditSourceTime } from '../time'
import type { CodeMaterialContext } from './contract'

/** Transient renderer data, not an author-language or persistence format. */
interface CodeMotionPose { matrix: CodeMatrix; opacity: number; /** Used before exposure validation by element corrections, never by the GPU. */ anchor?: [number, number] }
export interface CodeMotionSample { offset: VideoEditFrameOffset; pose: CodeMotionPose | null; weight: number }
interface CodeMotionInterval { start: VideoEditFrameOffset; end: VideoEditFrameOffset }
export interface CodeMotionClock {
  available: CodeMotionInterval
  at(offset: VideoEditFrameOffset): { context: CodeMaterialContext; parameters: Readonly<Record<string, unknown>>; sourceTime?: VideoEditSourceTime } | null
}
