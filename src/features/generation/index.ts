/** 跨宿主生成公开入口；调用方不伸进生成页内部。 */
export { generationApplicationService } from './application/generationApplicationService';
export type { GenerationModelFilterType } from './domain/generationDraft';
export { waitForGenerationCompletion } from './application/waitForGenerationCompletion';
