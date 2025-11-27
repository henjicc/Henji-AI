import React from 'react'
import SchemaForm from '@/components/ui/SchemaForm'
import TextInput from '@/components/ui/TextInput'
import Toggle from '@/components/ui/Toggle'
import NumberInput from '@/components/ui/NumberInput'
import PanelTrigger from '@/components/ui/PanelTrigger'
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
  minimaxSpeechBasicParams,
  minimaxSpeechAdvancedParams
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
        {selectedModel === 'veo3.1' && (
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

        {/* 通用负面提示和随机种子 */}
        {selectedModel !== 'minimax-hailuo-2.3' &&
         selectedModel !== 'minimax-hailuo-02' &&
         selectedModel !== 'wan-2.5-preview' &&
         selectedModel !== 'seedance-v1' &&
         selectedModel !== 'seedance-v1-lite' &&
         selectedModel !== 'seedance-v1-pro' &&
         selectedModel !== 'veo3.1' && (
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
         selectedModel !== 'veo3.1' && (
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
          maxImages: values.maxImages
        }}
        onChange={onChange}
      />
    )
  }

  // Nano Banana 参数
  if (selectedModel === 'nano-banana') {
    return (
      <SchemaForm
        schema={nanoBananaParams}
        values={{
          num_images: values.numImages,
          aspect_ratio: values.aspectRatio,
          uploadedImages
        }}
        onChange={onChange}
      />
    )
  }

  // Nano Banana Pro 参数
  if (selectedModel === 'nano-banana-pro') {
    return (
      <SchemaForm
        schema={nanoBananaProParams}
        values={{
          num_images: values.numImages,
          aspect_ratio: values.aspectRatio,
          resolution: values.resolution,
          uploadedImages
        }}
        onChange={onChange}
      />
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
