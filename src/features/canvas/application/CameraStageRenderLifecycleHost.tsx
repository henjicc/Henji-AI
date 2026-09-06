import { useEffect } from 'react';

import { installCameraStageRenderLifecycleHost } from './cameraStageRenderLifecycle';

export function CameraStageRenderLifecycleHost(): null {
  useEffect(() => {
    return installCameraStageRenderLifecycleHost();
  }, []);
  return null;
}
