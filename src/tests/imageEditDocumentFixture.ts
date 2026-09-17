import { afterEach, beforeEach } from 'vitest'
import { resetImageEditDocumentInstancesForTestsV3 } from '@/features/imageEdit/v3/application/imageEditDocumentInstances'

beforeEach(resetImageEditDocumentInstancesForTestsV3)
afterEach(resetImageEditDocumentInstancesForTestsV3)
