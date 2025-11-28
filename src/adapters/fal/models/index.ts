import { falAiNanoBananaRoute } from './fal-ai-nano-banana'
import { falAiNanoBananaProRoute } from './fal-ai-nano-banana-pro'
import { falAiVeo31Route } from './fal-ai-veo-3.1'
import { bytedanceSeedreamV4Route } from './bytedance-seedream-v4'
import { falAiZImageTurboRoute } from './fal-ai-z-image-turbo'

/**
 * 模型路由接口
 */
export interface FalModelRoute {
  matches: (modelId: string) => boolean
  buildImageRequest?: (params: any) => { submitPath: string; modelId: string; requestData: any }
  buildVideoRequest?: (params: any) => Promise<{ endpoint: string; modelId: string; requestData: any }>
}

/**
 * 所有 Fal 模型路由
 */
export const falModelRoutes: FalModelRoute[] = [
  falAiNanoBananaRoute,
  falAiNanoBananaProRoute,
  falAiVeo31Route,
  bytedanceSeedreamV4Route,
  falAiZImageTurboRoute
]

/**
 * 按模型ID查找路由
 */
export const findRoute = (modelId: string): FalModelRoute | undefined => {
  return falModelRoutes.find(route => route.matches(modelId))
}
