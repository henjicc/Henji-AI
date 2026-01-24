/**
 * i18next 配置
 */

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

// 导入翻译资源
import zhCN_common from './locales/zh-CN/common.json'
import zhCN_models from './locales/zh-CN/models.json'
import zhCN_params from './locales/zh-CN/params.json'
import zhCN_errors from './locales/zh-CN/errors.json'
import zhCN_ui from './locales/zh-CN/ui.json'
import zhCN_history from './locales/zh-CN/history.json'
import zhCN_settings from './locales/zh-CN/settings.json'

import enUS_common from './locales/en-US/common.json'
import enUS_models from './locales/en-US/models.json'
import enUS_params from './locales/en-US/params.json'
import enUS_errors from './locales/en-US/errors.json'
import enUS_ui from './locales/en-US/ui.json'
import enUS_history from './locales/en-US/history.json'
import enUS_settings from './locales/en-US/settings.json'

const resources = {
  'zh-CN': {
    common: zhCN_common,
    models: zhCN_models,
    params: zhCN_params,
    errors: zhCN_errors,
    ui: zhCN_ui,
    history: zhCN_history,
    settings: zhCN_settings,
  },
  'en-US': {
    common: enUS_common,
    models: enUS_models,
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
