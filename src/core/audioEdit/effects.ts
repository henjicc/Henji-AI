import { z } from 'zod'
import type { AudioEffectInstance } from '../audio/effects/audioEffectChain'
import { essentialSoundEffects, essentialSoundSettingsSchema } from '../audio/essentialSound'
import { videoEditBuiltinEffectIssue, videoEditBuiltinEffectMedia } from '../videoEdit/builtinEffects'
import type { AudioEditProjectDocument } from './types'

/**
 * 音频编辑的效果组（参照 Audition 的效果组）：一串内置音频效果，作用在剪好的整条声音上；
 * 基本声音（`essentialSound`）换算出的效果排在效果组前面。试听时实时处理，导出时同一份效果链离线处理整条声音。
 * 效果的登记、参数含义与处理实现和剪辑片段的音频效果是同一份（`src/core/audio/effects`）。
 */

export const AUDIO_EDIT_MAX_EFFECTS = 16

export const audioEditEffectSchema = z.object({
  id: z.string().min(1).max(100), name: z.string().trim().min(1).max(200), enabled: z.boolean(), amount: z.number().finite().min(0).max(1),
  builtin: z.object({ id: z.string().min(1).max(64), params: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/), z.union([z.number().finite(), z.boolean(), z.string().max(4096)])) }).strict(),
}).strict().superRefine((effect, ctx) => {
  if (videoEditBuiltinEffectMedia(effect.builtin.id) !== 'audio') ctx.addIssue({ code: 'custom', message: `效果组只能放音频效果（${effect.builtin.id} 不是音频效果）。` })
  const issue = videoEditBuiltinEffectIssue(effect.builtin)
  if (issue) ctx.addIssue({ code: 'custom', message: issue })
})
export const audioEditEffectsSchema = z.array(audioEditEffectSchema).max(AUDIO_EDIT_MAX_EFFECTS)
export type AudioEditEffect = z.infer<typeof audioEditEffectSchema>
export { essentialSoundSettingsSchema as audioEditEssentialSoundSchema }

/**
 * 实时效果链（试听与导出共用）：基本声音换算出的效果在前，效果组里开着的效果在后；效果组整体关闭时只剩基本声音。
 */
export function audioEditRealtimeEffects(project: Pick<AudioEditProjectDocument, 'effects' | 'effectsBypassed' | 'essentialSound'>): AudioEffectInstance[] {
  const rack = project.effectsBypassed ? [] : (project.effects ?? []).filter(effect => effect.enabled && effect.amount > 0)
  return [...essentialSoundEffects(project.essentialSound), ...rack]
}
