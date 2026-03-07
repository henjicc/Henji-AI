export type MediaModelType = 'image' | 'video' | 'audio';

export interface ModelProviderDefinition {
  id: string;
  name: string;
  label: string;
}

export interface AspectRatioOption {
  value: string;
  label: string;
}

export interface ResolutionOption {
  value: string;
  label: string;
}

export type ExtraParamType = 'boolean' | 'enum' | 'number' | 'string';

export interface ExtraParamDefinition {
  key: string;
  label: string;
  type: ExtraParamType;
  description?: string;
  defaultValue?: boolean | number | string;
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  step?: number;
}

export interface ImageModelDefinition {
  id: string;
  mediaType: 'image';
  displayName: string;
  providerId: string;
  description: string;
  eta: string;
  expectedDurationMs?: number;
  defaultAspectRatio: string;
  defaultResolution: string;
  aspectRatios: AspectRatioOption[];
  resolutions: ResolutionOption[];
  extraParamsSchema?: ExtraParamDefinition[];
  defaultExtraParams?: Record<string, unknown>;
  resolveRequest: (context: { referenceImageCount: number }) => {
    requestModel: string;
    modeLabel: string;
  };
}
