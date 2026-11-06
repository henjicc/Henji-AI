import type { DeveloperTestRequest, DeveloperTestResult } from '@/core/developer/developerTest'

export interface DeveloperPlatform {
  runTest(request: DeveloperTestRequest): Promise<DeveloperTestResult>
  cancelTest(requestId: string): Promise<void>
}
