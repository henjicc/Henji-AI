import React, { useState } from 'react'
import SchemaForm from '@/components/ui/SchemaForm'
import TextInput from '@/components/ui/TextInput'
import Toggle from '@/components/ui/Toggle'
import NumberInput from '@/components/ui/NumberInput'
import PanelTrigger from '@/components/ui/PanelTrigger'
import ModelscopeCustomModelManager from './ModelscopeCustomModelManager'
import {
  viduParams,
  klingParams,
  hailuoParams,
  pixverseParams,
  wan25Params,
  seedanceParams,
  veoParams,
  seedreamParams,
  nanoBananaParams,
  nanoBananaProParams,
  falAiBytedanceSeedreamV4Params,
  falAiBytedanceSeedanceV1Params,
  minimaxSpeechBasicParams,
  minimaxSpeechAdvancedParams,
  falAiZImageTurboParams,
  modelscopeCommonParams,
  modelscopeCustomParams,
  modelscopeZImageTurboParams,
  qwenImageEdit2509Params,
  falAiKlingImageO1Params,
  klingVideoO1Params,
  falAiKlingVideoV26ProParams,
  falAiSora2Params,
  falAiLtx2Params,
  falAiViduQ2Params,
  falAiPixverseV55Params,
  falAiWan25PreviewParams,
  falAiMinimaxHailuo23Params,
  falAiMinimaxHailuo02Params,
  kieNanoBananaProParams,
  kieGrokImagineParams,
  kieGrokImagineVideoParams,
  kieSeedream45Params,
  kieSeedream40Params,
  kieZImageParams,
  kieKlingV26Params,
  kieHailuo23Params
} from '@/models'
import { voicePresets } from '../utils/constants'

interface ParameterPanelProps {
  currentModel: any
  selectedModel: string
  uploadedImages: string[]

  // 所有参数值
  values: Record<string, any>

  // 参数变更回调
  onChange: (id: string, value: any) => void
}

/**
 * 参数配置面板
 * 根据当前选择的模型显示对应的参数配置
 */
const ParameterPanel: React.FC<ParameterPanelProps> = ({
  currentModel,
  selectedModel,
  uploadedImages,
  values,
  onChange
}) => {
  // Vidu Q1 参数
  if (selectedModel === 'vidu-q1') {
    return (
      <SchemaForm
        schema={viduParams}
        values={{
          ppioViduQ1Mode: values.ppioViduQ1Mode,
          ppioViduQ1AspectRatio: values.ppioViduQ1AspectRatio,
          ppioViduQ1Style: values.ppioViduQ1Style,
          ppioViduQ1MovementAmplitude: values.ppioViduQ1MovementAmplitude,
          ppioViduQ1Bgm: values.ppioViduQ1Bgm,
          uploadedImages
        }}
        onChange={onChange}
      />
    )
  }

  // 视频模型参数
  if (currentModel?.type === 'video' && selectedModel !== 'vidu-q1' && selectedModel !== 'kie-grok-imagine-video' && selectedModel !== 'grok-imagine-video-kie' && selectedModel !== 'kie-kling-v2-6' && selectedModel !== 'kling-v2-6-kie' && selectedModel !== 'kie-hailuo-2-3' && selectedModel !== 'hailuo-2-3-kie') {
    return (
      <>
        {/* Hailuo 参数 */}
        {(selectedModel === 'minimax-hailuo-2.3' || selectedModel === 'minimax-hailuo-02') && (
          <>
            <SchemaForm
              schema={hailuoParams}
              values={{
                ppioHailuo23VideoDuration: values.ppioHailuo23VideoDuration,
                ppioHailuo23VideoResolution: values.ppioHailuo23VideoResolution,
                ppioHailuo23FastMode: values.ppioHailuo23FastMode,
                selectedModel,
                uploadedImages
              }}
              onChange={onChange}
            />
            <Toggle
              label="提示词优化"
              checked={values.ppioHailuo23EnablePromptExpansion}
              onChange={(v) => onChange('ppioHailuo23EnablePromptExpansion', v)}
              className="w-auto"
            />
          </>
        )}

        {/* PixVerse 参数 */}
        {selectedModel === 'pixverse-v4.5' && (
          <SchemaForm
            schema={pixverseParams}
            values={{
              ppioPixverse45VideoAspectRatio: values.ppioPixverse45VideoAspectRatio,
              ppioPixverse45VideoResolution: values.ppioPixverse45VideoResolution,
              ppioPixverse45FastMode: values.ppioPixverse45FastMode,
              uploadedImages
            }}
            onChange={onChange}
          />
        )}

        {/* Kling 参数 */}
        {selectedModel === 'kling-2.5-turbo' && (
          <SchemaForm
            schema={klingParams}
            values={{
              ppioKling25VideoDuration: values.ppioKling25VideoDuration,
              ppioKling25VideoAspectRatio: values.ppioKling25VideoAspectRatio,
              ppioKling25CfgScale: values.ppioKling25CfgScale,
              uploadedImages
            }}
            onChange={onChange}
          />
        )}

        {/* Wan 2.5 参数 */}
        {selectedModel === 'wan-2.5-preview' && (
          <>
            <SchemaForm
              schema={wan25Params}
              values={{
                ppioWan25Size: values.ppioWan25Size,
                falWan25Resolution: values.falWan25Resolution,
                ppioWan25VideoDuration: values.ppioWan25VideoDuration,
                ppioWan25PromptExtend: values.ppioWan25PromptExtend,
                ppioWan25Audio: values.ppioWan25Audio,
                uploadedImages
              }}
              onChange={onChange}
            />
            <TextInput
              label="负面提示"
              value={values.videoNegativePrompt}
              onChange={(v) => onChange('videoNegativePrompt', v)}
              placeholder="不希望出现的内容"
              className="w-auto flex-1 min-w-[200px]"
              inputClassName="w-full"
            />
          </>
        )}

        {/* Seedance 参数（派欧云） */}
        {(selectedModel === 'seedance-v1' || selectedModel === 'seedance-v1-lite' || selectedModel === 'seedance-v1-pro') && (
          <SchemaForm
            schema={seedanceParams}
            values={{
              ppioSeedanceV1Variant: values.ppioSeedanceV1Variant,
              ppioSeedanceV1VideoDuration: values.ppioSeedanceV1VideoDuration,
              ppioSeedanceV1Resolution: values.ppioSeedanceV1Resolution,
              ppioSeedanceV1AspectRatio: values.ppioSeedanceV1AspectRatio,
              ppioSeedanceV1CameraFixed: values.ppioSeedanceV1CameraFixed,
              selectedModel,
              uploadedImages
            }}
            onChange={onChange}
          />
        )}

        {/* Bytedance Seedance v1 参数（Fal） */}
        {(selectedModel === 'fal-ai-bytedance-seedance-v1' || selectedModel === 'bytedance-seedance-v1') && (
          <SchemaForm
            schema={falAiBytedanceSeedanceV1Params}
            values={{
              falSeedanceV1Mode: values.falSeedanceV1Mode,
              falSeedanceV1Version: values.falSeedanceV1Version,
              ppioSeedanceV1AspectRatio: values.ppioSeedanceV1AspectRatio,
              ppioSeedanceV1Resolution: values.ppioSeedanceV1Resolution,
              seedanceResolution: values.ppioSeedanceV1Resolution,  // qualityKey 映射
              falSeedanceV1VideoDuration: values.falSeedanceV1VideoDuration,
              ppioSeedanceV1CameraFixed: values.ppioSeedanceV1CameraFixed,
              falSeedanceV1FastMode: values.falSeedanceV1FastMode,
              uploadedImages
            }}
            onChange={onChange}
          />
        )}

        {/* Veo 3.1 参数 */}
        {(selectedModel === 'veo3.1' || selectedModel === 'fal-ai-veo-3.1') && (
          <SchemaForm
            schema={veoParams}
            values={{
              falVeo31Mode: values.falVeo31Mode,
              falVeo31VideoDuration: values.falVeo31VideoDuration,
              falVeo31AspectRatio: values.falVeo31AspectRatio,
              falVeo31Resolution: values.falVeo31Resolution,
              veoResolution: values.falVeo31Resolution,  // qualityKey 映射
              falVeo31EnhancePrompt: values.falVeo31EnhancePrompt,
              falVeo31GenerateAudio: values.falVeo31GenerateAudio,
              falVeo31AutoFix: values.falVeo31AutoFix,
              falVeo31FastMode: values.falVeo31FastMode,
              uploadedImages
            }}
            onChange={onChange}
          />
        )}

        {/* Kling Video O1 参数 */}
        {(selectedModel === 'fal-ai-kling-video-o1' || selectedModel === 'kling-video-o1') && (
          <SchemaForm
            schema={klingVideoO1Params}
            values={{
              falKlingVideoO1Mode: values.falKlingVideoO1Mode,
              falKlingVideoO1VideoDuration: values.falKlingVideoO1VideoDuration,
              falKlingVideoO1AspectRatio: values.falKlingVideoO1AspectRatio,
              falKlingVideoO1KeepAudio: values.falKlingVideoO1KeepAudio,
              uploadedImages
            }}
            onChange={onChange}
          />
        )}

        {/* Kling Video v2.6 Pro 参数 */}
        {(selectedModel === 'fal-ai-kling-video-v2.6-pro' || selectedModel === 'kling-video-v2.6-pro') && (
          <SchemaForm
            schema={falAiKlingVideoV26ProParams}
            values={{
              falKlingV26ProVideoDuration: values.falKlingV26ProVideoDuration,
              falKlingV26ProAspectRatio: values.falKlingV26ProAspectRatio,
              falKlingV26ProGenerateAudio: values.falKlingV26ProGenerateAudio,
              falKlingV26ProCfgScale: values.falKlingV26ProCfgScale,
              uploadedImages
            }}
            onChange={onChange}
          />
        )}

        {/* Sora 2 参数 */}
        {(selectedModel === 'fal-ai-sora-2' || selectedModel === 'sora-2') && (
          <SchemaForm
            schema={falAiSora2Params}
            values={{
              falSora2Mode: values.falSora2Mode,
              falSora2AspectRatio: values.falSora2AspectRatio,
              soraResolution: values.falSora2Resolution,  // 映射到实际的 state 变量
              falSora2VideoDuration: values.falSora2VideoDuration,
              uploadedImages
            }}
            onChange={onChange}
          />
        )}

        {/* LTX-2 参数 */}
        {(selectedModel === 'fal-ai-ltx-2' || selectedModel === 'ltx-2') && (
          <SchemaForm
            schema={falAiLtx2Params}
            values={{
              falLtx2Mode: values.falLtx2Mode,
              falLtx2Resolution: values.falLtx2Resolution,
              falLtx2VideoDuration: values.falLtx2VideoDuration,
              falLtx2Fps: values.falLtx2Fps,
              falLtx2GenerateAudio: values.falLtx2GenerateAudio,
              falLtx2FastMode: values.falLtx2FastMode,
              falLtx2RetakeDuration: values.falLtx2RetakeDuration,
              falLtx2RetakeStartTime: values.falLtx2RetakeStartTime,
              falLtx2RetakeMode: values.falLtx2RetakeMode,
              uploadedImages,
              uploadedVideos: values.uploadedVideos
            }}
            onChange={onChange}
          />
        )}

        {/* Vidu Q2 参数 */}
        {(selectedModel === 'fal-ai-vidu-q2' || selectedModel === 'vidu-q2') && (
          <SchemaForm
            schema={falAiViduQ2Params}
            values={{
              falViduQ2Mode: values.falViduQ2Mode,
              falViduQ2AspectRatio: values.falViduQ2AspectRatio,
              falViduQ2Resolution: values.falViduQ2Resolution,
              viduQ2Resolution: values.falViduQ2Resolution,  // qualityKey 映射
              falViduQ2VideoDuration: values.falViduQ2VideoDuration,
              falViduQ2MovementAmplitude: values.falViduQ2MovementAmplitude,
              falViduQ2Bgm: values.falViduQ2Bgm,
              falViduQ2FastMode: values.falViduQ2FastMode,
              uploadedImages,
              uploadedVideos: values.uploadedVideos
            }}
            onChange={onChange}
          />
        )}

        {/* Pixverse V5.5 参数 */}
        {(selectedModel === 'fal-ai-pixverse-v5.5' || selectedModel === 'pixverse-v5.5') && (
          <SchemaForm
            schema={falAiPixverseV55Params}
            values={{
              falPixverse55AspectRatio: values.falPixverse55AspectRatio,
              falPixverse55Resolution: values.falPixverse55Resolution,
              pixverseResolution: values.falPixverse55Resolution,  // qualityKey 映射
              falPixverse55VideoDuration: values.falPixverse55VideoDuration,
              falPixverse55Style: values.falPixverse55Style,
              falPixverse55ThinkingType: values.falPixverse55ThinkingType,
              falPixverse55GenerateAudio: values.falPixverse55GenerateAudio,
              falPixverse55MultiClip: values.falPixverse55MultiClip,
              uploadedImages
            }}
            onChange={onChange}
          />
        )}

        {/* Fal Wan 2.5 Preview 参数 */}
        {(selectedModel === 'fal-ai-wan-25-preview' || selectedModel === 'wan-25-preview') && (
          <SchemaForm
            schema={falAiWan25PreviewParams}
            values={{
              falWan25VideoDuration: values.falWan25VideoDuration,
              falWan25AspectRatio: values.falWan25AspectRatio,
              falWan25Resolution: values.falWan25Resolution,
              wanResolution: values.falWan25Resolution,  // qualityKey 映射
              falWan25PromptExpansion: values.falWan25PromptExpansion,
              uploadedImages
            }}
            onChange={onChange}
          />
        )}

        {/* Fal MiniMax Hailuo 2.3 参数 */}
        {(selectedModel === 'fal-ai-minimax-hailuo-2.3' || selectedModel === 'minimax-hailuo-2.3-fal') && (
          <SchemaForm
            schema={falAiMinimaxHailuo23Params}
            values={{
              falHailuo23Duration: values.falHailuo23Duration,
              falHailuo23Resolution: values.falHailuo23Resolution,
              falHailuo23FastMode: values.falHailuo23FastMode,
              falHailuo23PromptOptimizer: values.falHailuo23PromptOptimizer,
              uploadedImages
            }}
            onChange={onChange}
          />
        )}

        {/* Fal MiniMax Hailuo 02 参数 */}
        {(selectedModel === 'fal-ai-minimax-hailuo-02' || selectedModel === 'minimax-hailuo-02-fal') && (
          <SchemaForm
            schema={falAiMinimaxHailuo02Params}
            values={{
              falHailuo02Duration: values.falHailuo02Duration,
              falHailuo02Resolution: values.falHailuo02Resolution,
              falHailuo02FastMode: values.falHailuo02FastMode,
              falHailuo02PromptOptimizer: values.falHailuo02PromptOptimizer,
              uploadedImages
            }}
            onChange={onChange}
          />
        )}

        {/* 通用负面提示和随机种子 */}
        {selectedModel !== 'minimax-hailuo-2.3' &&
         selectedModel !== 'minimax-hailuo-02' &&
         selectedModel !== 'fal-ai-minimax-hailuo-2.3' &&
         selectedModel !== 'minimax-hailuo-2.3-fal' &&
         selectedModel !== 'fal-ai-minimax-hailuo-02' &&
         selectedModel !== 'minimax-hailuo-02-fal' &&
         selectedModel !== 'wan-2.5-preview' &&
         selectedModel !== 'seedance-v1' &&
         selectedModel !== 'seedance-v1-lite' &&
         selectedModel !== 'seedance-v1-pro' &&
         selectedModel !== 'fal-ai-bytedance-seedance-v1' &&
         selectedModel !== 'bytedance-seedance-v1' &&
         selectedModel !== 'veo3.1' &&
         selectedModel !== 'fal-ai-veo-3.1' &&
         selectedModel !== 'fal-ai-kling-video-o1' &&
         selectedModel !== 'kling-video-o1' &&
         selectedModel !== 'fal-ai-kling-video-v2.6-pro' &&
         selectedModel !== 'kling-video-v2.6-pro' &&
         selectedModel !== 'fal-ai-sora-2' &&
         selectedModel !== 'sora-2' &&
         selectedModel !== 'fal-ai-ltx-2' &&
         selectedModel !== 'ltx-2' &&
         selectedModel !== 'fal-ai-vidu-q2' &&
         selectedModel !== 'vidu-q2' &&
         selectedModel !== 'fal-ai-pixverse-v5.5' &&
         selectedModel !== 'pixverse-v5.5' &&
         selectedModel !== 'fal-ai-wan-25-preview' &&
         selectedModel !== 'wan-25-preview' && (
          <TextInput
            label="负面提示"
            value={values.videoNegativePrompt}
            onChange={(v) => onChange('videoNegativePrompt', v)}
            placeholder="不希望出现的内容"
            className="w-auto flex-1 min-w-[200px]"
            inputClassName="w-full"
          />
        )}

        {selectedModel !== 'kling-2.5-turbo' &&
         selectedModel !== 'minimax-hailuo-2.3' &&
         selectedModel !== 'minimax-hailuo-02' &&
         selectedModel !== 'fal-ai-minimax-hailuo-2.3' &&
         selectedModel !== 'minimax-hailuo-2.3-fal' &&
         selectedModel !== 'pixverse-v4.5' &&
         selectedModel !== 'wan-2.5-preview' &&
         selectedModel !== 'seedance-v1' &&
         selectedModel !== 'seedance-v1-lite' &&
         selectedModel !== 'seedance-v1-pro' &&
         selectedModel !== 'fal-ai-bytedance-seedance-v1' &&
         selectedModel !== 'bytedance-seedance-v1' &&
         selectedModel !== 'veo3.1' &&
         selectedModel !== 'fal-ai-veo-3.1' &&
         selectedModel !== 'fal-ai-kling-video-o1' &&
         selectedModel !== 'kling-video-o1' &&
         selectedModel !== 'fal-ai-kling-video-v2.6-pro' &&
         selectedModel !== 'kling-video-v2.6-pro' &&
         selectedModel !== 'fal-ai-sora-2' &&
         selectedModel !== 'sora-2' &&
         selectedModel !== 'fal-ai-ltx-2' &&
         selectedModel !== 'ltx-2' &&
         selectedModel !== 'fal-ai-pixverse-v5.5' &&
         selectedModel !== 'pixverse-v5.5' &&
         selectedModel !== 'fal-ai-wan-25-preview' &&
         selectedModel !== 'wan-25-preview' && (
          <NumberInput
            label="随机种子"
            value={typeof values.videoSeed === 'number' ? values.videoSeed : 0}
            onChange={(v) => onChange('videoSeed', Math.max(0, Math.round(v)))}
            min={0}
            step={1}
            widthClassName="w-20"
            className="w-auto min-w-[120px]"
          />
        )}
      </>
    )
  }

  // Seedream 4.0 参数
  if (selectedModel === 'seedream-4.0') {
    return (
      <SchemaForm
        schema={seedreamParams}
        values={{
          maxImages: values.maxImages,
          selectedResolution: values.selectedResolution,
          customWidth: values.customWidth,
          customHeight: values.customHeight,
          resolutionQuality: values.resolutionQuality,
          uploadedImages
        }}
        onChange={onChange}
      />
    )
  }

  // Nano Banana 参数
  if (selectedModel === 'nano-banana' || selectedModel === 'fal-ai-nano-banana') {
    return (
      <SchemaForm
        schema={nanoBananaParams}
        values={{
          falNanoBananaNumImages: values.falNanoBananaNumImages,
          falNanoBananaAspectRatio: values.falNanoBananaAspectRatio,
          uploadedImages
        }}
        onChange={onChange}
      />
    )
  }

  // Nano Banana Pro 参数
  if (selectedModel === 'nano-banana-pro' || selectedModel === 'fal-ai-nano-banana-pro') {
    return (
      <SchemaForm
        schema={nanoBananaProParams}
        values={{
          falNanoBananaProNumImages: values.falNanoBananaProNumImages,
          falNanoBananaProAspectRatio: values.falNanoBananaProAspectRatio,
          resolution: values.resolution,
          uploadedImages
        }}
        onChange={onChange}
      />
    )
  }

  // KIE Nano Banana Pro 参数
  if (selectedModel === 'kie-nano-banana-pro' || selectedModel === 'nano-banana-pro-kie') {
    return (
      <SchemaForm
        schema={kieNanoBananaProParams}
        values={{
          kieNanoBananaAspectRatio: values.kieNanoBananaAspectRatio,
          kieNanoBananaResolution: values.kieNanoBananaResolution,
          kieNanoBananaOutputFormat: values.kieNanoBananaOutputFormat,
          customWidth: values.customWidth,
          customHeight: values.customHeight,
          uploadedImages
        }}
        onChange={onChange}
      />
    )
  }

  // KIE Seedream 4.5 参数
  if (selectedModel === 'kie-seedream-4.5' || selectedModel === 'seedream-4.5-kie') {
    return (
      <SchemaForm
        schema={kieSeedream45Params}
        values={{
          kieSeedreamAspectRatio: values.kieSeedreamAspectRatio,
          kieSeedreamQuality: values.kieSeedreamQuality,
          customWidth: values.customWidth,
          customHeight: values.customHeight,
          uploadedImages
        }}
        onChange={onChange}
      />
    )
  }

  // KIE Seedream 4.0 参数
  if (selectedModel === 'kie-seedream-4.0' || selectedModel === 'seedream-4.0-kie') {
    return (
      <SchemaForm
        schema={kieSeedream40Params}
        values={{
          kieSeedream40AspectRatio: values.kieSeedream40AspectRatio,
          kieSeedream40Resolution: values.kieSeedream40Resolution,
          kieSeedream40MaxImages: values.kieSeedream40MaxImages,
          customWidth: values.customWidth,
          customHeight: values.customHeight,
          uploadedImages
        }}
        onChange={onChange}
      />
    )
  }

  // KIE Grok Imagine 参数
  if (selectedModel === 'kie-grok-imagine' || selectedModel === 'grok-imagine-kie') {
    return (
      <SchemaForm
        schema={kieGrokImagineParams}
        values={{
          kieGrokImagineAspectRatio: values.kieGrokImagineAspectRatio,
          customWidth: values.customWidth,
          customHeight: values.customHeight
        }}
        onChange={onChange}
      />
    )
  }

  // KIE Z-Image 参数
  if (selectedModel === 'kie-z-image' || selectedModel === 'z-image-kie') {
    return (
      <SchemaForm
        schema={kieZImageParams}
        values={{
          kieZImageAspectRatio: values.kieZImageAspectRatio,
          customWidth: values.customWidth,
          customHeight: values.customHeight
        }}
        onChange={onChange}
      />
    )
  }

  // KIE Grok Imagine Video 参数
  if (selectedModel === 'kie-grok-imagine-video' || selectedModel === 'grok-imagine-video-kie') {
    return (
      <SchemaForm
        schema={kieGrokImagineVideoParams}
        values={{
          kieGrokImagineVideoAspectRatio: values.kieGrokImagineVideoAspectRatio,
          kieGrokImagineVideoMode: values.kieGrokImagineVideoMode,
          uploadedImages
        }}
        onChange={onChange}
      />
    )
  }

  // KIE Kling V2.6 参数
  if (selectedModel === 'kie-kling-v2-6' || selectedModel === 'kling-v2-6-kie') {
    return (
      <SchemaForm
        schema={kieKlingV26Params}
        values={{
          kieKlingV26AspectRatio: values.kieKlingV26AspectRatio,
          kieKlingV26Duration: values.kieKlingV26Duration,
          kieKlingV26EnableAudio: values.kieKlingV26EnableAudio,
          uploadedImages
        }}
        onChange={onChange}
      />
    )
  }

  // KIE Hailuo 2.3 参数
  if (selectedModel === 'kie-hailuo-2-3' || selectedModel === 'hailuo-2-3-kie') {
    return (
      <SchemaForm
        schema={kieHailuo23Params}
        values={{
          kieHailuo23Mode: values.kieHailuo23Mode,
          kieHailuo23Duration: values.kieHailuo23Duration,
          kieHailuo23Resolution: values.kieHailuo23Resolution,
          uploadedImages
        }}
        onChange={onChange}
      />
    )
  }

  // ByteDance Seedream v4 参数
  if (selectedModel === 'bytedance-seedream-v4' || selectedModel === 'bytedance-seedream-v4.5' || selectedModel === 'fal-ai-bytedance-seedream-v4' || selectedModel === 'fal-ai-bytedance-seedream-v4.5') {
    return (
      <SchemaForm
        schema={falAiBytedanceSeedreamV4Params}
        values={{
          falSeedream40NumImages: values.falSeedream40NumImages,
          selectedResolution: values.selectedResolution,
          resolutionQuality: values.resolutionQuality,
          customWidth: values.customWidth,
          customHeight: values.customHeight,
          uploadedImages
        }}
        onChange={onChange}
      />
    )
  }

  // Z-Image-Turbo 参数
  if (selectedModel === 'fal-ai-z-image-turbo') {
    return (
      <SchemaForm
        schema={falAiZImageTurboParams}
        values={{
          falZImageTurboImageSize: values.falZImageTurboImageSize,
          customWidth: values.customWidth,
          customHeight: values.customHeight,
          resolutionBaseSize: values.resolutionBaseSize,
          falZImageTurboNumInferenceSteps: values.falZImageTurboNumInferenceSteps,
          falZImageTurboNumImages: values.falZImageTurboNumImages,
          falZImageTurboEnablePromptExpansion: values.falZImageTurboEnablePromptExpansion,
          falZImageTurboAcceleration: values.falZImageTurboAcceleration,
          uploadedImages
        }}
        onChange={onChange}
      />
    )
  }

  // Kling Image O1 参数
  if (selectedModel === 'fal-ai-kling-image-o1') {
    return (
      <SchemaForm
        schema={falAiKlingImageO1Params}
        values={{
          falKlingImageO1NumImages: values.falKlingImageO1NumImages,
          falKlingImageO1AspectRatio: values.falKlingImageO1AspectRatio,
          resolution: values.resolution,
          uploadedImages
        }}
        onChange={onChange}
      />
    )
  }

  // 魔搭 Z-Image-Turbo（无 guidance 参数）
  if (selectedModel === 'Tongyi-MAI/Z-Image-Turbo') {
    return (
      <>
        {/* 分辨率、采样步数 */}
        <SchemaForm
          schema={modelscopeZImageTurboParams.slice(0, 2)}
          values={{
            modelscopeImageSize: values.modelscopeImageSize,
            customWidth: values.customWidth,
            customHeight: values.customHeight,
            resolutionBaseSize: values.resolutionBaseSize,
            modelscopeSteps: values.modelscopeSteps
          }}
          onChange={onChange}
        />
        {/* 负面提示词单独一行，自动占据剩余空间 */}
        <TextInput
          label="负面提示词"
          value={values.modelscopeNegativePrompt}
          onChange={(v) => onChange('modelscopeNegativePrompt', v)}
          placeholder="输入不希望出现的内容..."
          className="flex-1 min-w-[200px]"
          inputClassName="w-full"
        />
      </>
    )
  }

  // Qwen-Image-Edit-2509 参数（支持图片编辑，最多3张图片）
  if (selectedModel === 'Qwen/Qwen-Image-Edit-2509') {
    return (
      <SchemaForm
        schema={qwenImageEdit2509Params}
        values={{
          modelscopeImageSize: values.modelscopeImageSize,
          customWidth: values.customWidth,
          customHeight: values.customHeight,
          resolutionBaseSize: values.resolutionBaseSize,
          modelscopeSteps: values.modelscopeSteps,
          uploadedImages
        }}
        onChange={onChange}
      />
    )
  }

  // 魔搭其他预设模型参数（包含 guidance）
  if (selectedModel === 'Qwen/Qwen-Image' ||
      selectedModel === 'black-forest-labs/FLUX.1-Krea-dev' ||
      selectedModel === 'MusePublic/14_ckpt_SD_XL' ||
      selectedModel === 'MusePublic/majicMIX_realistic') {
    return (
      <>
        {/* 分辨率、采样步数、引导系数 */}
        <SchemaForm
          schema={modelscopeCommonParams.slice(0, 3)}
          values={{
            modelscopeImageSize: values.modelscopeImageSize,
            customWidth: values.customWidth,
            customHeight: values.customHeight,
            resolutionBaseSize: values.resolutionBaseSize,
            modelscopeSteps: values.modelscopeSteps,
            modelscopeGuidance: values.modelscopeGuidance
          }}
          onChange={onChange}
        />
        {/* 负面提示词单独一行，自动占据剩余空间 */}
        <TextInput
          label="负面提示词"
          value={values.modelscopeNegativePrompt}
          onChange={(v) => onChange('modelscopeNegativePrompt', v)}
          placeholder="输入不希望出现的内容..."
          className="flex-1 min-w-[200px]"
          inputClassName="w-full"
        />
      </>
    )
  }

  // 魔搭自定义模型参数
  if (selectedModel === 'modelscope-custom') {
    // 使用 state 来触发重新渲染
    const [refreshKey, setRefreshKey] = useState(0)

    return (
      <>
        {/* 模型选择、分辨率、采样步数、引导系数 */}
        <SchemaForm
          key={refreshKey} // 当 refreshKey 变化时，强制重新渲染
          schema={modelscopeCustomParams.slice(0, 4)}
          values={{
            modelscopeCustomModel: values.modelscopeCustomModel,
            modelscopeImageSize: values.modelscopeImageSize,
            customWidth: values.customWidth,
            customHeight: values.customHeight,
            resolutionBaseSize: values.resolutionBaseSize,
            modelscopeSteps: values.modelscopeSteps,
            modelscopeGuidance: values.modelscopeGuidance
          }}
          onChange={onChange}
        />

        {/* 模型管理按钮 */}
        <PanelTrigger
          label="管理模型"
          display="配置"
          className="w-auto min-w-[100px] flex-shrink-0"
          panelWidth={600}
          alignment="aboveCenter"
          closeOnPanelClick={false}
          renderPanel={() => (
            <div className="flex flex-col bg-white/95 dark:bg-zinc-800 rounded-lg h-[500px] p-4">
              <ModelscopeCustomModelManager
                onModelsChange={() => setRefreshKey(prev => prev + 1)}
              />
            </div>
          )}
        />

        {/* 负面提示词单独一行，自动占据剩余空间 */}
        <TextInput
          label="负面提示词"
          value={values.modelscopeNegativePrompt}
          onChange={(v) => onChange('modelscopeNegativePrompt', v)}
          placeholder="输入不希望出现的内容..."
          className="flex-1 min-w-[200px]"
          inputClassName="w-full"
        />
      </>
    )
  }

  // MiniMax Speech 2.6 参数
  if (selectedModel === 'minimax-speech-2.6') {
    return (
      <>
        {/* 规格参数 */}
        <SchemaForm
          schema={minimaxSpeechBasicParams.slice(0, 1)}
          values={{ minimaxAudioSpec: values.minimaxAudioSpec }}
          onChange={onChange}
        />

        {/* 音色选择面板 */}
        <PanelTrigger
          label="音色"
          display={voicePresets.find(v => v.id === values.minimaxVoiceId)?.name || values.minimaxVoiceId}
          className="w-auto min-w-[140px] flex-shrink-0"
          panelWidth={720}
          alignment="aboveCenter"
          stableHeight={true}
          closeOnPanelClick={(t) => !!(t as HTMLElement).closest('[data-close-on-select]')}
          renderPanel={() => (
            <div className="p-4 h-full flex flex-col">
              <div className="mb-3">
                <div className="text-xs text-zinc-400 mb-2">性别</div>
                <div className="flex flex-wrap gap-2">
                  {[
                    { label: '全部', value: 'all' },
                    { label: '男', value: 'male' },
                    { label: '女', value: 'female' },
                    { label: '童声', value: 'child' },
                    { label: '其他', value: 'other' }
                  ].map(g => (
                    <button
                      key={g.value}
                      type="button"
                      onClick={() => onChange('voiceFilterGender', g.value)}
                      className={`px-3 py-2 text-xs rounded transition-all duration-300 outline-none focus:outline-none focus-visible:outline-none ring-0 focus:ring-0 focus-visible:ring-0 ${
                        values.voiceFilterGender === g.value
                          ? 'bg-[#007eff] text-white'
                          : 'bg-zinc-700/50 text-zinc-300 hover:bg-zinc-600/50'
                      }`}
                    >
                      {g.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                <div className="grid grid-cols-3 gap-2">
                  {voicePresets
                    .filter(v => values.voiceFilterGender === 'all' ? true : v.gender === values.voiceFilterGender)
                    .map(v => (
                      <div
                        key={v.id}
                        data-close-on-select
                        onClick={() => onChange('minimaxVoiceId', v.id)}
                        className={`px-3 py-3 cursor-pointer transition-colors duration-200 rounded-lg border ${
                          values.minimaxVoiceId === v.id
                            ? 'bg-[#007eff]/20 text-[#66b3ff] border-[#007eff]/30'
                            : 'bg-zinc-700/40 hover:bg-zinc-700/60 border-zinc-700/50'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm">{v.name}</span>
                          <span className="text-[11px] text-zinc-400">{v.id}</span>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          )}
        />

        {/* 情绪和语言增强参数 */}
        <SchemaForm
          schema={minimaxSpeechBasicParams.slice(1, 3)}
          values={{
            minimaxAudioEmotion: values.minimaxAudioEmotion,
            minimaxLanguageBoost: values.minimaxLanguageBoost
          }}
          onChange={onChange}
        />

        {/* 高级选项面板 */}
        <PanelTrigger
          label="高级选项"
          display="打开"
          className="w-auto min-w-[100px] flex-shrink-0"
          panelWidth={576}
          alignment="aboveCenter"
          closeOnPanelClick={false}
          renderPanel={() => (
            <div className="flex flex-col bg-white/95 dark:bg-zinc-800 rounded-lg max-h-[420px]">
              <div className="p-4 flex flex-col gap-4 overflow-y-auto">
                <div className="flex gap-4">
                  <SchemaForm
                    schema={minimaxSpeechAdvancedParams.slice(0, 3)}
                    values={{
                      minimaxAudioVol: values.minimaxAudioVol,
                      minimaxAudioPitch: values.minimaxAudioPitch,
                      minimaxAudioSpeed: values.minimaxAudioSpeed
                    }}
                    onChange={onChange}
                  />
                </div>
                <div className="flex gap-4">
                  <SchemaForm
                    schema={minimaxSpeechAdvancedParams.slice(3, 7)}
                    values={{
                      minimaxAudioSampleRate: values.minimaxAudioSampleRate,
                      minimaxAudioBitrate: values.minimaxAudioBitrate,
                      minimaxAudioFormat: values.minimaxAudioFormat,
                      minimaxAudioChannel: values.minimaxAudioChannel
                    }}
                    onChange={onChange}
                  />
                </div>
                <div className="flex gap-4">
                  <SchemaForm
                    schema={minimaxSpeechAdvancedParams.slice(7, 9)}
                    values={{
                      minimaxLatexRead: values.minimaxLatexRead,
                      minimaxTextNormalization: values.minimaxTextNormalization
                    }}
                    onChange={onChange}
                  />
                </div>
              </div>
            </div>
          )}
        />
      </>
    )
  }

  return null
}

export default ParameterPanel
