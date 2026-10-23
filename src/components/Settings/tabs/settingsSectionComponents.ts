import LanguageSection from '../sections/LanguageSection'
import StartupSection from '../sections/StartupSection'
import OnboardingSection from '../sections/OnboardingSection'
import ImageViewerSection from '../sections/ImageViewerSection'
import UpdateSection from '../sections/UpdateSection'
import AboutSection from '../sections/AboutSection'
import HardwareCapabilitiesSection from '../sections/HardwareCapabilitiesSection'
import { RecordingShortcutSettings } from '@/features/screenRecording/RecordingShortcutSettings'
import { AssistantMemorySection } from '@/features/assistant/memory/AssistantMemorySection'
import AgentUserInstructionsSection from '../sections/AgentUserInstructionsSection'
import McpSection from '../sections/McpSection'
import PaidApprovalSection from '../sections/PaidApprovalSection'
import CanvasSection from '../sections/CanvasSection'
import AssetLibrarySection from '../sections/AssetLibrarySection'
import VideoEditSection from '../sections/VideoEditSection'
import { VideoEditShortcutSettings } from '@/features/videoEdit/panels/VideoEditShortcutSettings'
import DataPathSection from '../sections/DataPathSection'
import MediaCacheSection from '../sections/MediaCacheSection'
import LargeUploadSection from '../sections/LargeUploadSection'
import UploadSection from '../sections/UploadSection'
import LocalModelsSection from '../sections/LocalModelsSection'
import SoundLibrarySection from '../sections/SoundLibrarySection'
import AgentSkillsSection from '../sections/AgentSkillsSection'
import ExperimentalSection from '../sections/ExperimentalSection'
import type React from 'react'
import type { SettingsComponentKey } from '@/core/types/settingsNavigation'
import { ThemeSettingsSection, GenerationSettingsSection, DownloadSettingsSection, AssistantModelsSection, ProviderSettingsSection, RecordingSettingsSection, type SettingsSectionContext } from './settingsSectionContent'
export type { SettingsSectionContext } from './settingsSectionContent'

/** 这里只绑定可复用的内容组件，不重复声明分区、大类、标题或顺序。 */
export const SETTINGS_SECTION_COMPONENTS: Record<SettingsComponentKey, React.ComponentType<SettingsSectionContext>> = {
  LanguageSection,
  StartupSection,
  OnboardingSection,
  ImageViewerSection,
  RecordingShortcutSettings,
  AudioCaptureSettingsForm: RecordingSettingsSection,
  ThemeSettingsSection,
  ExperimentalSection,
  UpdateSection,
  AboutSection,
  HardwareCapabilitiesSection,
  ProviderCenterSection: ProviderSettingsSection,
  GenerationSettingsSection,
  CanvasSection,
  VideoEditSection,
  VideoEditShortcutSettings,
  AssetLibrarySection,
  DataPathSection,
  MediaCacheSection,
  LargeUploadSection,
  UploadSection,
  DownloadSettingsSection,
  SoundLibrarySection,
  LocalModelsSection,
  AssistantModelsSection,
  AgentUserInstructionsSection,
  PaidApprovalSection,
  AssistantMemorySection,
  McpSection,
  AgentSkillsSection,
}
