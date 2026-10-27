import { z } from 'zod'

export const appStorePlatformSchema = z.enum(['iphone', 'ipad', 'mac'])
const countrySchema = z.string().regex(/^[a-zA-Z]{2}$/).default('cn')
export const searchAppStoreIconsSchema = z.object({
  query: z.string().trim().min(1).max(500), country: countrySchema,
  platform: appStorePlatformSchema.default('iphone'), limit: z.number().int().min(1).max(25).default(8),
}).strict()
export const saveAppStoreIconSchema = z.object({
  appId: z.string().regex(/^\d+$/), country: countrySchema,
  platform: appStorePlatformSchema.default('iphone'),
  resolution: z.union([z.literal(512), z.literal(1024)]).default(1024),
  shape: z.enum(['official', 'square']).default('official'),
  projectId: z.string().min(1).optional().describe('来自 list_projects；省略时使用当前文档所在项目，没有当前项目时需明确指定。'),
}).strict()
export const appStoreIconCandidateSchema = z.object({
  appId: z.string(), name: z.string(), developer: z.string(),
  platform: appStorePlatformSchema, category: z.string(),
}).strict()
export type SearchAppStoreIconsInput = z.infer<typeof searchAppStoreIconsSchema>
export type SaveAppStoreIconInput = z.infer<typeof saveAppStoreIconSchema>
export type AppStoreIconCandidate = z.infer<typeof appStoreIconCandidateSchema>
export interface AppStoreIconSearchResult { country: string; candidates: AppStoreIconCandidate[] }
export interface SavedAppStoreIcon {
  assetRef: { kind: 'asset'; id: string }
  projectId: string
  name: string
  width: number
  height: number
  transparentCorners: boolean
  verification: { verified: boolean; condition: string }
}
