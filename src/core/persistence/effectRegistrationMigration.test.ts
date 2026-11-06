import { migrateVideoAuthor, migrateRecordingAuthor } from '../videoEdit/styles/authorVersionMigration'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { migrateAudioEqualizerModes, migrateAudioMergedEffects } from '../audio/effects/mergedEffectsMigration'
import { migrateRecordingTransitions, migrateVideoEditTransitions } from '../videoEdit/transitionMigration'
import { PERSISTENCE_FORMATS } from './formats'
import { upgradePersistenceContent } from './migrations'
import { migrateEmbeddedVideoEditCodeEditChecks, migrateVideoEditCodeEditChecks } from '../videoEdit/codeEditCheckMigration'

it('效果登记顺延保留音频合并迁移，已登记样本与旧作者源码原样读取', () => {
  for (const [id, audioVersion] of [['document.video_edit', 48], ['document.screen_recording', 51]] as const) {
    const format = PERSISTENCE_FORMATS.find(value => value.id === id)!
    const previous = format.version - 1
    const read = (version: number): unknown => JSON.parse(readFileSync(`tests/fixtures/persistence/${id}/v${version}.json`, 'utf8')).content
    const released = read(previous), before = structuredClone(released)
    // 剪辑内容 74 → 75（录制 77 → 78）只给已有手改补检查记录，与作者接口无关。
    const migrateAuthor = id === 'document.video_edit' ? (value: unknown) => migrateVideoEditCodeEditChecks(migrateVideoAuthor(value)) : (value: unknown) => migrateEmbeddedVideoEditCodeEditChecks(migrateRecordingAuthor(value))
    expect(upgradePersistenceContent(format, released, previous)).toEqual(format.schema.parse(migrateAuthor(released)))
    expect(released).toEqual(before)
    const audio = read(audioVersion), audioBefore = structuredClone(audio)
    const migrateTransitions = id === 'document.video_edit' ? migrateVideoEditTransitions : migrateRecordingTransitions
    expect(upgradePersistenceContent(format, audio, audioVersion)).toEqual(format.schema.parse(migrateAuthor(migrateTransitions(migrateAudioEqualizerModes(migrateAudioMergedEffects(audio))))))
    expect(audio).toEqual(audioBefore)
    // 正式生成的新样本含 all；迁移不能把已登记作者接口和库锁定提升到新接口。
    const current = read(format.version)
    const hasAllDeclaration = (value: unknown): boolean => typeof value === 'string' ? value.includes('"all"') : Boolean(value && typeof value === 'object' && Object.values(value).some(hasAllDeclaration))
    expect(hasAllDeclaration(current), id).toBe(true)
    expect(format.schema.safeParse(current).success).toBe(true)
  }
})
