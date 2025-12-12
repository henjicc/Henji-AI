import { kieNanoBananaProRoute, KIEModelRoute } from './nano-banana-pro'
import { kieGrokImagineRoute } from './grok-imagine'
import { kieGrokImagineVideoRoute } from './grok-imagine-video'

export type { KIEModelRoute }

export const kieModelRoutes: KIEModelRoute[] = [
  kieNanoBananaProRoute,
  kieGrokImagineRoute,
  kieGrokImagineVideoRoute
]

export const findRoute = (modelId: string): KIEModelRoute | undefined => {
  return kieModelRoutes.find(route => route.matches(modelId))
}
