/**
 * i18next 配置
 */

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

// 导入翻译资源
import zhCN_common from './locales/zh-CN/common.json'
import zhCN_models from './locales/zh-CN/models.json'
import zhCN_models_modelscope from './locales/zh-CN/models-modelscope.json'
import zhCN_models_kie from './locales/zh-CN/models-kie.json'
import zhCN_models_apimart from './locales/zh-CN/models-apimart.json'
import zhCN_models_fal from './locales/zh-CN/models-fal.json'
import zhCN_models_ppio from './locales/zh-CN/models-ppio.json'
import zhCN_params from './locales/zh-CN/params.json'
import zhCN_errors from './locales/zh-CN/errors.json'
import zhCN_ui from './locales/zh-CN/ui.json'
import zhCN_history from './locales/zh-CN/history.json'
import zhCN_settings from './locales/zh-CN/settings.json'
import zhCN_storyboard from './locales/zh-CN/storyboard.json'

import enUS_common from './locales/en-US/common.json'
import enUS_models from './locales/en-US/models.json'
import enUS_models_modelscope from './locales/en-US/models-modelscope.json'
import enUS_models_kie from './locales/en-US/models-kie.json'
import enUS_models_apimart from './locales/en-US/models-apimart.json'
import enUS_models_fal from './locales/en-US/models-fal.json'
import enUS_models_ppio from './locales/en-US/models-ppio.json'
import enUS_params from './locales/en-US/params.json'
import enUS_errors from './locales/en-US/errors.json'
import enUS_ui from './locales/en-US/ui.json'
import enUS_history from './locales/en-US/history.json'
import enUS_settings from './locales/en-US/settings.json'
import enUS_storyboard from './locales/en-US/storyboard.json'


type ModelLocale = DynamicValueMap & { defs?: DynamicValueMap }

function mergeModelDefs(base: ModelLocale, ...sources: ModelLocale[]): ModelLocale {
  const mergedDefs: DynamicValueMap = { ...(base.defs || {}) }
  sources.forEach((src) => {
    if (src && typeof src === 'object' && src.defs && typeof src.defs === 'object') {
      Object.assign(mergedDefs, src.defs as DynamicValueMap)
    }
  })
  return { ...base, defs: mergedDefs }
}

function isPlainRecord(value: DynamicValue): value is DynamicValueMap {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function deepMergeLocale(
  base: DynamicValueMap,
  extension: DynamicValueMap
): DynamicValueMap {
  const next: DynamicValueMap = { ...base }
  Object.entries(extension).forEach(([key, value]) => {
    const baseValue = next[key]
    if (isPlainRecord(baseValue) && isPlainRecord(value)) {
      next[key] = deepMergeLocale(baseValue, value)
      return
    }
    next[key] = value
  })
  return next
}

const resources = {
  'zh-CN': {
    common: deepMergeLocale(zhCN_common as DynamicValueMap, zhCN_storyboard as DynamicValueMap),
    models: mergeModelDefs(zhCN_models, zhCN_models_ppio, zhCN_models_fal, zhCN_models_kie, zhCN_models_apimart, zhCN_models_modelscope),
    params: zhCN_params,
    errors: zhCN_errors,
    ui: zhCN_ui,
    history: zhCN_history,
    settings: zhCN_settings,
  },
  'en-US': {
    common: deepMergeLocale(enUS_common as DynamicValueMap, enUS_storyboard as DynamicValueMap),
    models: mergeModelDefs(enUS_models, enUS_models_ppio, enUS_models_fal, enUS_models_kie, enUS_models_apimart, enUS_models_modelscope),
    params: enUS_params,
    errors: enUS_errors,
    ui: enUS_ui,
    history: enUS_history,
    settings: enUS_settings,
  },
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'zh-CN',
    defaultNS: 'common',
    ns: ['common', 'models', 'params', 'errors', 'ui', 'history', 'settings'],

    interpolation: {
      escapeValue: false, // React 已经转义
    },

    detection: {
      order: ['localStorage', 'navigator'],
      caches: [],
      lookupLocalStorage: 'henji-language',
    },

    debug: import.meta.env.DEV,
  })

export default i18n
