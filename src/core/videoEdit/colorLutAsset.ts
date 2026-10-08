import { z } from 'zod'
export const colorLutAssetSchema = z.object({ id: z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/), name: z.string().min(1).max(200), path: z.string().min(1).max(32768).regex(/^(?:[A-Za-z]:[\\/]|\\\\|\/)/), contentIdentity: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
export type ColorLutAsset = z.infer<typeof colorLutAssetSchema>
