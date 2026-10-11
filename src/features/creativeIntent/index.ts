export { CreativeIntentControls, type CreativeIntentControlsProps } from './ui/CreativeIntentControls'
export { CreativeIntentOverlay, type CreativeIntentGhost } from './ui/CreativeIntentOverlay'
export { RecordingCollector, type RecordingPresentation } from './recording/RecordingCollector'
export { captureMicrophone, type CapturedAudioBlock, type MicrophoneCapture } from './recording/microphone'
export { ExplanationReview, type ExplanationReviewProps, type ExplanationReviewResult } from './ui/ExplanationReview'
export { ExplanationPanel, type ExplanationPanelProps } from './ui/ExplanationPanel'
export { explanationDuration, useExplanationTranscript, useExplanationHasRecorded } from './ui/explanationPresentation'

export { prepareExplanationGeneration, type PreparedExplanationGeneration, type ExplanationSendRequest } from './application/explanationGeneration'
