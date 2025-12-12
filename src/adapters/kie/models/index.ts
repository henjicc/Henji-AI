import { kieNanoBananaProRoute, KIEModelRoute } from './nano-banana-pro'
import { kieGrokImagineRoute } from './grok-imagine'

export type { KIEModelRoute }

export const kieModelRoutes: KIEModelRoute[] = [
  kieNanoBananaProRoute,
  kieGrokImagineRoute
]

export const findRoute = (modelId: string): KIEModelRoute | undefined => {
  return kieModelRoutes.find(route => route.matches(modelId))
}
