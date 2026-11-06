import type { DeveloperPlatform } from '@/platform/contracts/developer'

function nativeDeveloper(): NonNullable<typeof window.henjiNative>['developer'] {
  const native = window.henjiNative?.developer
  if (!native) throw new Error('[platform:developer] henjiNative.developer is not available')
  return native
}

export function createElectronDeveloper(): DeveloperPlatform {
  return {
    runTest: (request) => nativeDeveloper().runTest(request),
    cancelTest: (requestId) => nativeDeveloper().cancelTest(requestId),
  }
}
