import type { VideoEditComposition, VideoEditSequence } from './document'
import { authorEffectEnvironmentForStyle } from './authorEffects'
import { videoEditFps } from './time'

/** 序列可选状态只来自本序列；工程素材与环境由宿主快照提供。 */
export function composeVideoEditSequence(document: Pick<VideoEditComposition, 'media' | 'items' | 'sequences' | 'styles' | 'templates' | 'colorLuts' | 'codeMaterials' | 'scenes' | 'revision' | 'foreign' | 'authorEffects'>, sequence: VideoEditSequence): VideoEditComposition {
  return { ...sequence, ...(document.authorEffects ? { authorEffects: authorEffectEnvironmentForStyle(document.authorEffects, document.styles, sequence.styleId) } : {}), width: Math.round(sequence.width * sequence.pixelAspectRatio.numerator / sequence.pixelAspectRatio.denominator), media: document.media, items: document.items, sequences: document.sequences, ...(document.styles ? { styles: document.styles } : {}), ...(document.templates ? { templates: document.templates } : {}), ...(document.colorLuts ? { colorLuts: document.colorLuts } : {}), ...(document.codeMaterials ? { codeMaterials: document.codeMaterials } : {}), ...(document.scenes ? { scenes: document.scenes } : {}), ...(document.foreign ? { foreign: document.foreign } : {}), revision: document.revision, fps: videoEditFps(sequence.frameRate) }
}
