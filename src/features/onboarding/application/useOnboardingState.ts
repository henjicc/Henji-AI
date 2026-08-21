import { useSyncExternalStore } from 'react'

import { onboardingManager, type OnboardingSnapshot } from './onboardingManager'

export function useOnboardingState(): OnboardingSnapshot {
  return useSyncExternalStore(
    onboardingManager.subscribe,
    onboardingManager.getSnapshot,
    onboardingManager.getSnapshot
  )
}
