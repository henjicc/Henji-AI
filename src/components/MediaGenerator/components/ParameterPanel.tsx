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
  minimaxSpeechBasicParams,
  minimaxSpeechAdvancedParams,
  falAiZImageTurboParams,
  modelscopeCommonParams,
  modelscopeCustomParams,
  modelscopeZImageTurboParams,
  qwenImageEdit2509Params,
  falAiKlingImageO1Params,
  klingVideoO1Params
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
          viduMode: values.viduMode,
          viduAspectRatio: values.viduAspectRatio,
          viduStyle: values.viduStyle,
          viduMovementAmplitude: values.viduMovementAmplitude,
          viduBgm: values.viduBgm,
          uploadedImages
        }}
        onChange={onChange}
      />
    )
  }

  // 视频模型参数
  if (currentModel?.type === 'video' && selectedModel !== 'vidu-q1') {
    return (
      <>
        {/* Hailuo 参数 */}
        {(selectedModel === 'minimax-hailuo-2.3' || selectedModel === 'minimax-hailuo-02') && (
          <>
            <SchemaForm
              schema={hailuoParams}
              values={{
                videoDuration: values.videoDuration,
                videoResolution: values.videoResolution,
                hailuoFastMode: values.hailuoFastMode,
                selectedModel,
                uploadedImages
              }}
              onChange={onChange}
            />
            <Toggle
              label="提示词优化"
              checked={values.minimaxEnablePromptExpansion}
              onChange={(v) => onChange('minimaxEnablePromptExpansion', v)}
              className="w-auto"
            />
          </>
        )}

        {/* PixVerse 参数 */}
        {selectedModel === 'pixverse-v4.5' && (
          <SchemaForm
            schema={pixverseParams}
            values={{
              videoAspectRatio: values.videoAspectRatio,
              videoResolution: values.videoResolution,
              pixFastMode: values.pixFastMode,
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
              videoDuration: values.videoDuration,
              videoAspectRatio: values.videoAspectRatio,
              klingCfgScale: values.klingCfgScale,
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
                wanSize: values.wanSize,
                wanResolution: values.wanResolution,
                videoDuration: values.videoDuration,
                wanPromptExtend: values.wanPromptExtend,
                wanAudio: values.wanAudio,
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

        {/* Seedance 参数 */}
        {(selectedModel === 'seedance-v1' || selectedModel === 'seedance-v1-lite' || selectedModel === 'seedance-v1-pro') && (
          <SchemaForm
            schema={seedanceParams}
            values={{
              seedanceVariant: values.seedanceVariant,
              videoDuration: values.videoDuration,
              seedanceResolution: values.seedanceResolution,
              seedanceAspectRatio: values.seedanceAspectRatio,
              seedanceCameraFixed: values.seedanceCameraFixed,
              selectedModel,
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
              veoMode: values.veoMode,
              videoDuration: values.videoDuration,
              veoAspectRatio: values.veoAspectRatio,
              veoResolution: values.veoResolution,
              veoEnhancePrompt: values.veoEnhancePrompt,
              veoGenerateAudio: values.veoGenerateAudio,
              veoAutoFix: values.veoAutoFix,
              veoFastMode: values.veoFastMode,
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
              klingMode: values.klingMode,
              videoDuration: values.videoDuration,
              klingAspectRatio: values.klingAspectRatio,
              klingKeepAudio: values.klingKeepAudio,
              uploadedImages
            }}
            onChange={onChange}
          />
        )}

        {/* 通用负面提示和随机种子 */}
        {selectedModel !== 'minimax-hailuo-2.3' &&
         selectedModel !== 'minimax-hailuo-02' &&
         selectedModel !== 'wan-2.5-preview' &&
         selectedModel !== 'seedance-v1' &&
         selectedModel !== 'seedance-v1-lite' &&
         selectedModel !== 'seedance-v1-pro' &&
         selectedModel !== 'veo3.1' &&
         selectedModel !== 'fal-ai-veo-3.1' &&
         selectedModel !== 'fal-ai-kling-video-o1' &&
         selectedModel !== 'kling-video-o1' && (
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
         selectedModel !== 'pixverse-v4.5' &&
         selectedModel !== 'wan-2.5-preview' &&
         selectedModel !== 'seedance-v1' &&
         selectedModel !== 'seedance-v1-lite' &&
         selectedModel !== 'seedance-v1-pro' &&
         selectedModel !== 'veo3.1' &&
         selectedModel !== 'fal-ai-veo-3.1' &&
         selectedModel !== 'fal-ai-kling-video-o1' &&
         selectedModel !== 'kling-video-o1' && (
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
          num_images: values.numImages,
          aspectRatio: values.aspectRatio,
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
          num_images: values.numImages,
          aspectRatio: values.aspectRatio,
          resolution: values.resolution,
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
          numImages: values.numImages,
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
          imageSize: values.imageSize,
          customWidth: values.customWidth,
          customHeight: values.customHeight,
          resolutionBaseSize: values.resolutionBaseSize,
          numInferenceSteps: values.numInferenceSteps,
          numImages: values.numImages,
          enablePromptExpansion: values.enablePromptExpansion,
          acceleration: values.acceleration,
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
          num_images: values.numImages,
          aspectRatio: values.aspectRatio,
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
            imageSize: values.imageSize,
            customWidth: values.customWidth,
            customHeight: values.customHeight,
            resolutionBaseSize: values.resolutionBaseSize,
            steps: values.steps
          }}
          onChange={onChange}
        />
        {/* 负面提示词单独一行，自动占据剩余空间 */}
        <TextInput
          label="负面提示词"
          value={values.negativePrompt}
          onChange={(v) => onChange('negativePrompt', v)}
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
          imageSize: values.imageSize,
          customWidth: values.customWidth,
          customHeight: values.customHeight,
          resolutionBaseSize: values.resolutionBaseSize,
          steps: values.steps,
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
            imageSize: values.imageSize,
            customWidth: values.customWidth,
            customHeight: values.customHeight,
            resolutionBaseSize: values.resolutionBaseSize,
            steps: values.steps,
            guidance: values.guidance
          }}
          onChange={onChange}
        />
        {/* 负面提示词单独一行，自动占据剩余空间 */}
        <TextInput
          label="负面提示词"
          value={values.negativePrompt}
          onChange={(v) => onChange('negativePrompt', v)}
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
            imageSize: values.imageSize,
            customWidth: values.customWidth,
            customHeight: values.customHeight,
            resolutionBaseSize: values.resolutionBaseSize,
            steps: values.steps,
            guidance: values.guidance
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
          value={values.negativePrompt}
          onChange={(v) => onChange('negativePrompt', v)}
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
          values={{ audioSpec: values.audioSpec }}
          onChange={onChange}
        />

        {/* 音色选择面板 */}
        <PanelTrigger
          label="音色"
          display={voicePresets.find(v => v.id === values.voiceId)?.name || values.voiceId}
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
                        onClick={() => onChange('voiceId', v.id)}
                        className={`px-3 py-3 cursor-pointer transition-colors duration-200 rounded-lg border ${
                          values.voiceId === v.id
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
            audioEmotion: values.audioEmotion,
            languageBoost: values.languageBoost
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
                      audioVol: values.audioVol,
                      audioPitch: values.audioPitch,
                      audioSpeed: values.audioSpeed
                    }}
                    onChange={onChange}
                  />
                </div>
                <div className="flex gap-4">
                  <SchemaForm
                    schema={minimaxSpeechAdvancedParams.slice(3, 7)}
                    values={{
                      audioSampleRate: values.audioSampleRate,
                      audioBitrate: values.audioBitrate,
                      audioFormat: values.audioFormat,
                      audioChannel: values.audioChannel
                    }}
                    onChange={onChange}
                  />
                </div>
                <div className="flex gap-4">
                  <SchemaForm
                    schema={minimaxSpeechAdvancedParams.slice(7, 9)}
                    values={{
                      latexRead: values.latexRead,
                      textNormalization: values.textNormalization
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
