import type { ImageEditOutpaintPlanV3 } from '@/core/imageEdit/v3/aiWorkflows/outpaint';
export interface ImageEditOutpaintJobV3 {
  taskId: string; documentId: string; plan: ImageEditOutpaintPlanV3; status: 'preparing' | 'generating' | 'placing' | 'placed' | 'failed' | 'cancelled';
  progress: number; layerId?: string; error?: string;
}
export const imageEditOutpaintJobsV3 = new Map<string, ImageEditOutpaintJobV3>();
const listeners = new Set<() => void>();
let version = 0;
export function updateImageEditOutpaintJobV3(id: string, patch: Partial<ImageEditOutpaintJobV3>): void {
  const job = imageEditOutpaintJobsV3.get(id);
  if (job) { imageEditOutpaintJobsV3.set(id, { ...job, ...patch }); version++; listeners.forEach(listener => listener()); }
}
export function subscribeImageEditOutpaintV3(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function imageEditOutpaintVersionV3(): number { return version; }
export function listImageEditOutpaintJobsV3(documentId: string): ImageEditOutpaintJobV3[] { return [...imageEditOutpaintJobsV3.values()].filter(job => job.documentId === documentId); }
export function readImageEditOutpaintJobV3(taskId: string): ImageEditOutpaintJobV3 | undefined { return imageEditOutpaintJobsV3.get(taskId); }
