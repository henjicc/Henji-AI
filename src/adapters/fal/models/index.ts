import { falAiNanoBananaRoute } from './fal-ai-nano-banana'
import { falAiNanoBananaProRoute } from './fal-ai-nano-banana-pro'
import { falAiVeo31Route } from './fal-ai-veo-3.1'
import { falAiBytedanceSeedreamV4Route } from './fal-ai-bytedance-seedream-v4'
import { falAiBytedanceSeedreamV45Route } from './fal-ai-bytedance-seedream-v4.5'
import { falAiZImageTurboRoute } from './fal-ai-z-image-turbo'
import { falAiKlingImageO1Route } from './fal-ai-kling-image-o1'

/**
 * 模型路由接口
 */
export interface FalModelRoute {
  matches: (modelId: string) => boolean
  buildImageRequest?: (params: any) => Promise<{ submitPath: string; modelId: string; requestData: any }> | { submitPath: string; modelId: string; requestData: any }
  buildVideoRequest?: (params: any) => Promise<{ endpoint: string; modelId: string; requestData: any }>
}

/**
 * 所有 Fal 模型路由
 */
export const falModelRoutes: FalModelRoute[] = [
  falAiNanoBananaRoute,
  falAiNanoBananaProRoute,
  falAiVeo31Route,
  falAiBytedanceSeedreamV4Route,
  falAiBytedanceSeedreamV45Route,
  falAiZImageTurboRoute,
  falAiKlingImageO1Route
]

/**
 * 按模型ID查找路由
 */
export const findRoute = (modelId: string): FalModelRoute | undefined => {
  return falModelRoutes.find(route => route.matches(modelId))
}
