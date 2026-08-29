import { afterEach, describe, expect, it } from 'vitest'

import i18n from '@/i18n'
import { createDefaultMultiAngleConfig } from '@/features/canvas/capabilities/multiAnglePolicy'

import {
  describeLocalizedMultiAngleCamera,
  summarizeLocalizedMultiAngleConfig,
  translateMultiAngleViewLabel,
} from './multiAngleLocalization'

describe('multi-angle localization', () => {
  afterEach(async () => {
    await i18n.changeLanguage('zh-CN')
  })

  it('英文界面不泄漏 FLUX 预设和原生控制的中文文案', async () => {
    await i18n.changeLanguage('en-US')
    const config = createDefaultMultiAngleConfig('flux-native-v1')
    const first = config.views[0]

    expect(translateMultiAngleViewLabel(i18n.t, first)).toBe('Front')
    expect(describeLocalizedMultiAngleCamera(i18n.t, first)).toBe(
      'Horizontal 0° · Vertical 0° · Zoom 5',
    )
    expect(summarizeLocalizedMultiAngleConfig(i18n.t, config)).toBe(
      'FLUX Native · 4 views',
    )
  })
})
