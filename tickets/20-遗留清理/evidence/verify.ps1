$env:NODE_OPTIONS = '--max-old-space-size=12288'
$taskFiles = @(
  'docs/rules/assistant-status.md',
  'src/core/application-control/domains/videoEdit/videoEditReviewCapability.ts',
  'src/features/videoEdit/application/videoEditReview.ts',
  'src/features/videoEdit/application/videoEditReview.test.ts',
  'src/features/videoEdit/engine/videoEditAuthorFingerprint.ts',
  'src/features/videoEdit/engine/videoEditAuthorFingerprint.test.ts',
  'src/features/videoEdit/engine/videoEditAuthorRuntime.ts',
  'src/features/videoEdit/engine/videoEditAuthorRuntime.test.ts'
)
$directTests = @(
  'src/features/videoEdit/engine/videoEditCodeFingerprint.test.ts',
  'src/features/videoEdit/engine/videoEditAuthorRuntimeResolution.test.ts',
  'src/features/videoEdit/application/videoEditVisualReview.test.ts',
  'src/features/videoEdit/application/videoEditSceneReview.test.ts',
  'src/features/videoEdit/application/videoEditMotionReviewWorkerClient.test.ts'
)
$verifyArgs = @('run', 'verify:changed', '--', '--level', 'L2') + $taskFiles
foreach ($testFile in $directTests) { $verifyArgs += @('--test', $testFile) }
if ($env:T20_VERIFY_DRY_RUN -eq '1') { $verifyArgs += '--dry-run' }
& npm.cmd @verifyArgs
exit $LASTEXITCODE
