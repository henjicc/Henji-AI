import type { VideoEditSpaceToneMapping } from '@/core/videoEdit/document'

/** 三维物体的色调映射（three 的 TSL 实现，第二个参数是曝光倍数）。实时与路径追踪共用。 */
export function videoEditToneMapping<F>(tsl: { neutralToneMapping: F; agxToneMapping: F; acesFilmicToneMapping: F }, mode: VideoEditSpaceToneMapping): F {
  return mode === 'agx' ? tsl.agxToneMapping : mode === 'aces' ? tsl.acesFilmicToneMapping : tsl.neutralToneMapping
}
