import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

// ES
import esCommon from './locales/es/common.json'
import esHeader from './locales/es/header.json'
import esCanvas from './locales/es/canvas.json'
import esGcode from './locales/es/gcode.json'
import esSerial from './locales/es/serial.json'
import esTools from './locales/es/tools.json'
import esMaterials from './locales/es/materials.json'
import esSettings from './locales/es/settings.json'
import esHelp from './locales/es/help.json'

// EN
import enCommon from './locales/en/common.json'
import enHeader from './locales/en/header.json'
import enCanvas from './locales/en/canvas.json'
import enGcode from './locales/en/gcode.json'
import enSerial from './locales/en/serial.json'
import enTools from './locales/en/tools.json'
import enMaterials from './locales/en/materials.json'
import enSettings from './locales/en/settings.json'
import enHelp from './locales/en/help.json'

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      es: {
        common: esCommon,
        header: esHeader,
        canvas: esCanvas,
        gcode: esGcode,
        serial: esSerial,
        tools: esTools,
        materials: esMaterials,
        settings: esSettings,
        help: esHelp,
      },
      en: {
        common: enCommon,
        header: enHeader,
        canvas: enCanvas,
        gcode: enGcode,
        serial: enSerial,
        tools: enTools,
        materials: enMaterials,
        settings: enSettings,
        help: enHelp,
      },
    },
    fallbackLng: 'es',
    defaultNS: 'common',
    ns: ['common', 'header', 'canvas', 'gcode', 'serial', 'tools', 'materials', 'settings', 'help'],
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['navigator', 'localStorage'],
      caches: ['localStorage'],
    },
  })

export default i18n
