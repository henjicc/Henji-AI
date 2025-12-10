import { kieNanoBananaProRoute, KIEModelRoute } from './nano-banana-pro'

export type { KIEModelRoute }

export const kieModelRoutes: KIEModelRoute[] = [
  kieNanoBananaProRoute
]

export const findRoute = (modelId: string): KIEModelRoute | undefined => {
  return kieModelRoutes.find(route => route.matches(modelId))
}
