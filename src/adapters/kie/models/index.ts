import { kieNanoBananaProRoute, KIEModelRoute } from './nano-banana-pro'
import { kieGrokImagineRoute } from './grok-imagine'
import { kieGrokImagineVideoRoute } from './grok-imagine-video'
import { kieSeedream45Route } from './seedream-4.5'

export type { KIEModelRoute }

export const kieModelRoutes: KIEModelRoute[] = [
  kieNanoBananaProRoute,
  kieSeedream45Route,
  kieGrokImagineRoute,
  kieGrokImagineVideoRoute
]

export const findRoute = (modelId: string): KIEModelRoute | undefined => {
  return kieModelRoutes.find(route => route.matches(modelId))
}
