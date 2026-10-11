import { defineModel } from '../defineModel'
import type { JsonObject } from '../../types/runtime'
import { speechCharacterPrice, speechNumber, speechString, speechText } from '../audio/tts-common'

// KIE 官方 Turbo 输入枚举；名称只供界面展示，不能提交为 voice。
const voiceIds = new Set([
  "EkK5I93UQWFDigLMpZcX",
  "Z3R5wn05IrDiVCyEkUrK",
  "NNl6r8mD7vthiJatiJt1",
  "YOq2y2Up4RgXP2HyXjE5",
  "B8gJV1IhpuegLxdpXFOE",
  "2zRM7PkgwBPiau2jvVXc",
  "1SM7GgM6IMuvQlz2BwM3",
  "5l5f8iK3YPeGga21rQIX",
  "scOwDtmlUjD3prqpp97I",
  "NOpBlnGInO9m6vDvFkFC",
  "BZgkqPqms7Kj9ulSkVzn",
  "wo6udizrrtpIxWGp2qJk",
  "gU0LNdkMOQCOrPrwtbee",
  "DGzg6RaUqxGRTHSBjfgF",
  "x70vRnQBMBu4FAYhjJbO",
  "Sm1seazb4gs7RSlUVw7c",
  "P1bg08DkjqiVEzOn76yG",
  "qDuRKMlYmrm8trt5QyBn",
  "qXpMhyvQqiRxWQs4qSSB",
  "TX3LPaxmHKxFdv7VOQHJ",
  "N2lVS1w4EtoT3dr4eOWO",
  "FGY2WhTYpPnrIDTdsKH5",
  "kPzsL2i3teMYv0FxEYQ6",
  "UgBBYS2sOqTuMpoF3BR0",
  "hpp4J3VqNfWAUOO0d1Us",
  "nPczCjzI2devNBz1zQrb",
  "uYXf8XasLslADfZ2MB4u",
  "gs0tAILXbY5DNrJrsM6F",
  "DTKMou8ccj1ZaWGBiotd",
  "vBKc2FfBKJfcZNyEt1n6",
  "DYkrAHD8iwork3YSUBbs",
  "56AoDkrOh6qfVPDXZ7Pt",
  "eR40ATw9ArzDf9h3v7t7",
  "g6xIsTj2HwM6VR4iXFCw",
  "lcMyyd2HUfFzxdCaC4Ta",
  "6aDn1KB0hjpdcocrUkmq",
  "Sq93GQT4X1lKDXsQcixO",
  "flHkNRp1BlvT73UL6gyz",
  "9yzdeviXkFddZ4Oz8Mok",
  "pPdl9cQBQq4p6mRkZy2Z",
  "zYcjlYFOd3taleS0gkk3",
  "nzeAacJi50IvxcyDnMXa",
  "ruirxsoakN0GWmGNIo04",
  "TC0Zp7WVFzhA8zpTlRqV",
  "ljo9gAlSqKOvF6D8sOsX",
  "PPzYpIqttlTYA83688JI",
  "8JVbfL6oEdmuxKn5DK2C",
  "iCrDUkL56s3C8sCRl7wb",
  "wJqPPQ618aTW29mptyoc",
  "EiNlNiXeDU1pqqOPrYMO",
  "4YYIPFl9wE5c4L2eu2Gb",
  "6F5Zhi321D3Oq7v1oNT4",
  "YXpFCvM1S3JbWEJhoskW",
  "LG95yZDEHg6fCZdQjLqj",
  "CeNX9CMwmxDxUF5Q2Inm",
  "aD6riP1btT197c6dACmy",
  "mtrellq69YZsNwzUSyXh",
  "dHd5gvgSOzSfduK4CvEg",
  "eVItLK1UvXctxuaRV2Oq",
  "esy0r39YPLQjOczyOib8",
  "Tsns2HvNFKfGiNjllgqo",
  "1U02n4nD6AdIZ9CjF053",
  "AeRdCCKzvd23BpJoofzx",
  "LruHrtVF6PSyGItzMNHS",
  "1wGbFxmAM3Fgw63G1zZJ",
  "hqfrgApggtO1785R4Fsn",
  "MJ0RnG71ty4LH3dvNfSd",
])
function turboVoice(value: JsonObject[string]): string {
  const voice = speechString(value) ?? 'EkK5I93UQWFDigLMpZcX'
  if (!voiceIds.has(voice)) throw new Error('KIE Turbo 需要官方音色 ID，请从音色列表重新选择，不能提交 Brian、Rachel 等显示名称。')
  return voice
}

export const kieElevenTurbo25TtsModel = defineModel({
  meta: {
    id: 'kie-eleven-turbo-2.5-tts', canonicalModelId: 'eleven-turbo-2.5-tts', provider: 'kie', type: 'audio',
    tags: ['text-to-audio', 'provider-kie'],
    polling: { interval: 3000, maxAttempts: 120, expectedAttempts: 20 },
  },
  inputLimits: { images: { max: 0 }, videos: { max: 0 } },
  params: [
    { id: 'kieElevenTurboVoice', type: 'composite', valueType: 'string', order: 1, default: 'EkK5I93UQWFDigLMpZcX' },
    { id: 'kieElevenTurboStability', type: 'number', order: 2, default: 0.5, min: 0, max: 1, step: 0.05 },
    { id: 'kieElevenTurboSpeed', type: 'number', order: 3, default: 1, min: 0.7, max: 1.2, step: 0.05 },
  ],
  endpoints: '/api/v1/jobs/createTask',
  request: {
    builder: (params): JsonObject => ({
      model: 'elevenlabs/text-to-speech-turbo-2-5',
      input: {
        text: speechText(params),
        voice: turboVoice(params.kieElevenTurboVoice),
        stability: speechNumber(params.kieElevenTurboStability) ?? 0.5,
        speed: speechNumber(params.kieElevenTurboSpeed) ?? 1,
      },
    }),
  },
  pricing: { currency: '$', calculator: params => speechCharacterPrice(params, 0.03), description: '$0.03/千字符' },
})

export default kieElevenTurbo25TtsModel
