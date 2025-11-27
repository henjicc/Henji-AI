import { seedream40Route } from './seedream'
import { klingTurbo25Route } from './kling-2.5-turbo'
import { minimaxHailuo23Route } from './minimax-hailuo-2.3'
import { minimaxHailuo02Route } from './minimax-hailuo-02'
import { viduQ1Route } from './vidu'
import { pixverseV45Route } from './pixverse'
import { wan25PreviewRoute } from './wan'
import { seedanceV1Route } from './seedance'
import { minimaxSpeech26Route } from './minimax-speech-2.6'

/**
 * 模型路由接口
 */
export interface ModelRoute {
  matches: (modelId: string) => boolean
  buildImageRequest?: (params: any) => { endpoint: string; requestData: any }
  buildVideoRequest?: (params: any) => { endpoint: string; requestData: any }
  buildAudioRequest?: (params: any) => { endpoint: string; requestData: any }
}

/**
 * 所有派欧云模型路由
 */
export const ppioModelRoutes: ModelRoute[] = [
  seedream40Route,
  klingTurbo25Route,
  minimaxHailuo23Route,
  minimaxHailuo02Route,
  viduQ1Route,
  pixverseV45Route,
  wan25PreviewRoute,
  seedanceV1Route,
  minimaxSpeech26Route
]

/**
 * 按模型ID查找路由
 */
export const findRoute = (modelId: string): ModelRoute | undefined => {
  return ppioModelRoutes.find(route => route.matches(modelId))
}
