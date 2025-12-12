import { kieNanoBananaProRoute, KIEModelRoute } from './nano-banana-pro'
import { kieGrokImagineRoute } from './grok-imagine'
import { kieGrokImagineVideoRoute } from './grok-imagine-video'
import { kieSeedream45Route } from './seedream-4.5'
import { kieSeedream40Route } from './seedream-4.0'
import { kieZImageRoute } from './z-image'
import { kieKlingV26Route } from './kling-v2-6'
import { kieHailuo23Route } from './hailuo-2-3'

export type { KIEModelRoute }

export const kieModelRoutes: KIEModelRoute[] = [
  kieNanoBananaProRoute,
  kieSeedream45Route,
  kieSeedream40Route,
  kieGrokImagineRoute,
  kieZImageRoute,
  kieGrokImagineVideoRoute,
  kieKlingV26Route,
  kieHailuo23Route
]

export const findRoute = (modelId: string): KIEModelRoute | undefined => {
  return kieModelRoutes.find(route => route.matches(modelId))
}
