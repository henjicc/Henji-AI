# Error Reference

<Warning>
  **Warning:**

  We are currently in a migration process and some APIs might not strictly follow the error structure documented below. We're working to ensure all errors conform to this specification as soon as possible.
</Warning>

## Error Response

When an API request fails due to client-side input issues (like validation errors) or server-side problems, the API returns a structured error response. This response includes a standard HTTP status code, specific headers, and a JSON body detailing the errors.

### Error Response Structure

The error response consists of:

1. **HTTP Status Code:** Indicates the general category of the error (e.g., `500` for internal errors, `504` for timeouts).
2. **Headers:** Includes required headers like `X-Fal-Retryable`.
3. **JSON Body:** Contains a `detail` field which is an array of `Error` objects.

### Headers

| Header            | Description                                                                                                                               |
| :---------------- | :---------------------------------------------------------------------------------------------------------------------------------------- |
| `X-Fal-Retryable` | **\[OPTIONAL]** A boolean (`"true"` or `"false"`) indicating if retrying the *exact same* request might succeed (e.g., transient issues). |

### Error Object Structure

The `detail` field is an array where each object represents a specific error.

| Property | Description                                                                                                                                                                                                                                                                                                                                    |
| :------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loc`    | **\[REQUIRED]** An array indicating the location of the error (e.g., `["body", "field_name"]` for input validation, `["body"]` for general errors). The first item in the loc list will be the field where the error occurred, and if the field is a sub-model, subsequent items will be present to indicate the nested location of the error. |
| `msg`    | **\[REQUIRED]** A human-readable description of the error. **Client code should not parse and rely on the msg field.**                                                                                                                                                                                                                         |
| `type`   | **\[REQUIRED]** A unique, **machine-readable** string identifying the error category (e.g., `image_too_large`). Use this for conditional logic.                                                                                                                                                                                                |
| `url`    | **\[REQUIRED]** A link to documentation about this specific error `type` (e.g., [https://docs.fal.ai/errors/#image\_too\_large\`](https://docs.fal.ai/errors/#image_too_large`)). Primarily for developers.                                                                                                                                    |
| `ctx`    | **\[OPTIONAL]** An object with additional structured, **machine-readable** context for the error `type` (e.g., `{"max_height": 1024, "max_width": 1024}` for `image_too_large`).                                                                                                                                                               |
| `input`  | **\[OPTIONAL]** The input that caused the error.                                                                                                                                                                                                                                                                                               |

### Guidance

* **For Machine Processing:** Rely on the `type` field for conditional logic. Use `ctx` for specific error details if available. Check the `X-Fal-Retryable` header for retry decisions.
* **For Human Display:** Use the `msg` field to show error messages to end-users. **Client code should not parse and rely on the msg field.**
* **For Documentation:** Use the `url` field to link to further documentation about the specific error. This is primarily intended for developers to get more detailed information about error handling and resolution.

## Error Types

This document details the specific error types returned by the API, following the structure defined in the error specification. Each error type has a unique `type` string, a human-readable `msg`, and potentially a `ctx` object with more context.

##### `internal_server_error`

This error indicates an unexpected issue occurred on the server that prevented the request from being fulfilled.

* **Status Code:** 500
* **Retryable:** Can be `true` or `false`.
* **Context (`ctx`):** None

```json  theme={null}
[
  {
    "loc": ["body"],
    "msg": "Internal server error",
    "type": "internal_server_error",
    "url": "https://docs.fal.ai/errors/#internal_server_error",
    "input": { "prompt": "a cat" }
  }
]
```

##### `generation_timeout`

This error occurs when the requested operation took longer than the allowed time limit to complete.

* **Status Code:** 504
* **Retryable:** Can be `true` or `false`.
* **Context (`ctx`):** None

```json  theme={null}
[
  {
    "loc": ["body"],
    "msg": "Generation timeout",
    "type": "generation_timeout",
    "url": "https://docs.fal.ai/errors/#generation_timeout",
    "input": { "prompt": "a very complex scene taking too long" }
  }
]
```

##### `downstream_service_error`

This error signifies a problem when communicating with an external service required to fulfill the request.

* **Status Code:** 400
* **Retryable:** Can be `true` or `false`.
* **Context (`ctx`):** None

```json  theme={null}
[
  {
    "loc": ["body"],
    "msg": "Downstream service error",
    "type": "downstream_service_error",
    "url": "https://docs.fal.ai/errors/#downstream_service_error",
    "input": { "some_input": "value" }
  }
]
```

##### `downstream_service_unavailable`

This error indicates that a required third-party service (**including partner APIs**) is currently unavailable, preventing the request from being fulfilled.

* **Status Code:** 500
* **Retryable:** Can be `true` or `false`.
* **Context (`ctx`):** None

```json  theme={null}
[
  {
    "loc": ["body"],
    "msg": "Downstream service unavailable",
    "type": "downstream_service_unavailable",
    "url": "https://docs.fal.ai/errors/#downstream_service_unavailable",
    "input": { "prompt": "a cat" }
  }
]
```

##### `content_policy_violation`

This error indicates that the provided input content (e.g., text prompt, uploaded image) could not be processed because it was flagged by automated safety systems as potentially violating usage policies or responsible AI guidelines.

* **Status Code:** 422
* **Retryable:** `false`.
* **Context (`ctx`):** None

These filters are in place to ensure safe, ethical, and legal use of the platform. **The content may have been flagged by either fal's filter or one of our partners'. Sensitivity levels can vary between partner APIs.**

Violations may include, but are not limited to:

* Content depicting NSFW content, promoting illegal acts or hate speech.
* Severely harmful content, such as depictions of extreme violence, gore, or content promoting self-harm.
* Content intended to promote misinformation, deception, harassment, or discrimination.
* Generation of content that infringes on third-party intellectual property rights.
* Content that perpetuates harmful stereotypes.

```json  theme={null}
[
  {
    "loc": ["body", "prompt"],
    "msg": "The content could not be processed because it contained material flagged by a content checker.",
    "type": "content_policy_violation",
    "url": "https://docs.fal.ai/errors/#content_policy_violation",
    "input": "a prompt containing forbidden content"
  }
]
```

##### `image_too_small`

This error indicates that the provided image dimensions are smaller than the required minimum.

* **Status Code:** 422
* **Retryable:** `false`.
* **Context (`ctx`):**
  * `min_height`: The minimum required height in pixels.
  * `min_width`: The minimum required width in pixels.

```json  theme={null}
[
  {
    "loc": ["body", "image_url"],
    "msg": "Image too small",
    "type": "image_too_small",
    "url": "https://docs.fal.ai/errors/#image_too_small",
    "ctx": {
      "min_height": 512,
      "min_width": 512
    },
    "input": "https://example.com/image_100x100.jpg"
  }
]
```

##### `image_too_large`

This error indicates that the provided image dimensions exceed the maximum allowed limits.

* **Status Code:** 422
* **Retryable:** `false`.
* **Context (`ctx`):**
  * `max_height`: The maximum allowed height in pixels.
  * `max_width`: The maximum allowed width in pixels.

```json  theme={null}
[
  {
    "loc": ["body", "input_image"],
    "msg": "Image too large",
    "type": "image_too_large",
    "url": "https://docs.fal.ai/errors/#image_too_large",
    "ctx": {
      "max_height": 1024,
      "max_width": 1024
    },
    "input": "https://example.com/image_2000x2000.jpg"
  }
]
```

##### `image_load_error`

This error occurs when the server failed to load or process the provided image, possibly due to corruption or an unsupported format.

* **Status Code:** 422
* **Retryable:** `false`.
* **Context (`ctx`):** None

```json  theme={null}
[
  {
    "loc": ["body", "control_image"],
    "msg": "Image load error",
    "type": "image_load_error",
    "url": "https://docs.fal.ai/errors/#image_load_error",
    "input": "https://example.com/corrupted_image.webp"
  }
]
```

##### `file_download_error`

This error indicates that the server failed to download a file specified by a URL in the input.
Make sure the URL is publicly accessible and that the file is not behind a login or authentication wall.

* **Status Code:** 422
* **Retryable:** `false`.
* **Context (`ctx`):** None

```json  theme={null}
[
  {
    "loc": ["body", "video_url"],
    "msg": "File download error",
    "type": "file_download_error",
    "url": "https://docs.fal.ai/errors/#file_download_error",
    "input": "https://private-server.com/file.mp4"
  }
]
```

##### `face_detection_error`

This error is raised when the system could not detect a face in the provided image, and face detection was required for the operation.

* **Status Code:** 422
* **Retryable:** `false`.
* **Context (`ctx`):** None

```json  theme={null}
[
  {
    "loc": ["body", "face_image"],
    "msg": "Could not detect face in the image",
    "type": "face_detection_error",
    "url": "https://docs.fal.ai/errors/#face_detection_error",
    "input": "https://example.com/landscape_no_face.jpg"
  }
]
```

##### `file_too_large`

This error indicates that the provided file exceeds the maximum allowed size.

* **Status Code:** 422
* **Retryable:** `false`.
* **Context (`ctx`):**
  * `max_size`: The maximum allowed file size in bytes.

```json  theme={null}
[
  {
    "loc": ["body", "upload_file"],
    "msg": "File too large",
    "type": "file_too_large",
    "url": "https://docs.fal.ai/errors/#file_too_large",
    "ctx": {
      "max_size": 10485760 // 10MB
    },
    "input": "https://example.com/large_video.mp4"
  }
]
```

##### `greater_than`

This error occurs when a numeric input value is not strictly greater than the specified threshold.

* **Status Code:** 422
* **Retryable:** `false`.
* **Context (`ctx`):**
  * `gt`: The value the input must be greater than.

```json  theme={null}
[
  {
    "loc": ["body", "num_inference_steps"],
    "msg": "Input should be greater than 0",
    "type": "greater_than",
    "url": "https://docs.fal.ai/errors/#greater_than",
    "ctx": {
      "gt": 0
    },
    "input": 0
  }
]
```

##### `greater_than_equal`

This error occurs when a numeric input value is less than the specified threshold.

* **Status Code:** 422
* **Retryable:** `false`.
* **Context (`ctx`):**
  * `ge`: The value the input must be greater than or equal to.

```json  theme={null}
[
  {
    "loc": ["body", "strength"],
    "msg": "Input should be greater than or equal to 0",
    "type": "greater_than_equal",
    "url": "https://docs.fal.ai/errors/#greater_than_equal",
    "ctx": {
      "ge": 0
    },
    "input": -0.5
  }
]
```

##### `less_than`

This error occurs when a numeric input value is not strictly less than the specified threshold.

* **Status Code:** 422
* **Retryable:** `false`.
* **Context (`ctx`):**
  * `lt`: The value the input must be less than.

```json  theme={null}
[
  {
    "loc": ["body", "negative_prompt_weight"],
    "msg": "Input should be less than 1",
    "type": "less_than",
    "url": "https://docs.fal.ai/errors/#less_than",
    "ctx": {
      "lt": 1.0
    },
    "input": 1.0
  }
]
```

##### `less_than_equal`

This error occurs when a numeric input value is greater than the specified threshold.

* **Status Code:** 422
* **Retryable:** `false`.
* **Context (`ctx`):**
  * `le`: The value the input must be less than or equal to.

```json  theme={null}
[
  {
    "loc": ["body", "guidance_scale"],
    "msg": "Input should be less than or equal to 20",
    "type": "less_than_equal",
    "url": "https://docs.fal.ai/errors/#less_than_equal",
    "ctx": {
      "le": 20
    },
    "input": 21
  }
]
```

##### `multiple_of`

This error indicates that a numeric input value is not a multiple of the required factor.

* **Status Code:** 422
* **Retryable:** `false`.
* **Context (`ctx`):**
  * `multiple_of`: The factor the input must be a multiple of.

```json  theme={null}
[
  {
    "loc": ["body", "width"],
    "msg": "Input should be a multiple of 8",
    "type": "multiple_of",
    "url": "https://docs.fal.ai/errors/#multiple_of",
    "ctx": {
      "multiple_of": 8
    },
    "input": 513
  }
]
```

##### `sequence_too_short`

This error occurs when a sequence (like a list or string) has fewer items/characters than the required minimum length.

* **Status Code:** 422
* **Retryable:** `false`.
* **Context (`ctx`):**
  * `min_length`: The minimum required length of the sequence.

```json  theme={null}
[
  {
    "loc": ["body", "prompts"],
    "msg": "Sequence should have at least 1 items",
    "type": "sequence_too_short",
    "url": "https://docs.fal.ai/errors/#sequence_too_short",
    "ctx": {
      "min_length": 1
    },
    "input": []
  }
]
```

##### `sequence_too_long`

This error occurs when a sequence (like a list or string) has more items/characters than the allowed maximum length.

* **Status Code:** 422
* **Retryable:** `false`.
* **Context (`ctx`):**
  * `max_length`: The maximum allowed length of the sequence.

```json  theme={null}
[
  {
    "loc": ["body", "controlnet_images"],
    "msg": "Sequence should have at most 4 items",
    "type": "sequence_too_long",
    "url": "https://docs.fal.ai/errors/#sequence_too_long",
    "ctx": {
      "max_length": 4
    },
    "input": ["img1.jpg", "img2.jpg", "img3.jpg", "img4.jpg", "img5.jpg"]
  }
]
```

##### `one_of`

This error indicates that the input value provided for a field is not among the set of allowed values.

* **Status Code:** 422
* **Retryable:** `false`.
* **Context (`ctx`):**
  * `expected`: A list containing the allowed values.

```json  theme={null}
[
  {
    "loc": ["body", "scheduler"],
    "msg": "Input should be 'EulerA' or 'DPM++'",
    "type": "one_of",
    "url": "https://docs.fal.ai/errors/#one_of",
    "ctx": {
      "expected": ["EulerA", "DPM++"]
    },
    "input": "InvalidScheduler"
  }
]
```

##### `feature_not_supported`

This error is raised when the combination of input parameters requests a feature or mode that is not supported by the endpoint.

* **Status Code:** 422
* **Retryable:** `false`.
* **Context (`ctx`):** None

```json  theme={null}
[
  {
    "loc": ["body", "advanced_feature"],
    "msg": "Feature not supported",
    "type": "feature_not_supported",
    "url": "https://docs.fal.ai/errors/#feature_not_supported",
    "input": true
  }
]
```

##### `invalid_archive`

This error occurs when the provided archive file (e.g., .zip, .tar) cannot be read or processed, likely due to corruption or an unsupported format.

* **Status Code:** 422
* **Retryable:** `false`.
* **Context (`ctx`):**
  * `supported_extensions`: A list of supported archive file extensions.

```json  theme={null}
[
  {
    "loc": ["body", "training_data"],
    "msg": "Could not read or process the provided archive. Ensure it's a valid, non-corrupted archive.",
    "type": "invalid_archive",
    "url": "https://docs.fal.ai/errors/#invalid_archive",
    "ctx": {
      "supported_extensions": [".zip", ".tar.gz"]
    },
    "input": "https://example.com/corrupted_archive.rar"
  }
]
```

##### `archive_file_count_below_minimum`

This error indicates that the provided archive contains fewer files matching the required criteria (e.g., specific extensions) than the minimum required count.

* **Status Code:** 422
* **Retryable:** `false`.
* **Context (`ctx`):**
  * `min_count`: The minimum number of required files.
  * `provided_count`: The number of matching files found in the archive.
  * `supported_extensions`: The file extensions that were counted. (e.g., extensions like `.jpg`, `.png` when used for image archives or `.mp4` when used for video archives).

```json  theme={null}
[
  {
    "loc": ["body", "image_archive"],
    "msg": "Too few files in the archive. Expected at least 10 files with extensions .jpg, .png, found 8. Add more matching files to the archive.",
    "type": "archive_file_count_below_minimum",
    "url": "https://docs.fal.ai/errors/#archive_file_count_below_minimum",
    "ctx": {
      "min_count": 10,
      "provided_count": 8,
      "supported_extensions": [".jpg", ".png"]
    },
    "input": "https://example.com/images_few.zip"
  }
]
```

##### `archive_file_count_exceeds_maximum`

This error indicates that the provided archive contains more files matching the required criteria (e.g., specific extensions) than the maximum allowed count.

* **Status Code:** 422
* **Retryable:** `false`.
* **Context (`ctx`):**
  * `max_count`: The maximum number of allowed files.
  * `provided_count`: The number of matching files found in the archive.
  * `supported_extensions`: The file extensions that were counted. (e.g., extensions like `.jpg`, `.png` when used for image archives or `.mp4` when used for video archives).

```json  theme={null}
[
  {
    "loc": ["body", "image_archive"],
    "msg": "Too many files in the archive. Maximum is 100 files with extensions .jpg, .png, found 150. Remove 50 matching files from the archive.",
    "type": "archive_file_count_exceeds_maximum",
    "url": "https://docs.fal.ai/errors/#archive_file_count_exceeds_maximum",
    "ctx": {
      "max_count": 100,
      "provided_count": 150,
      "supported_extensions": [".jpg", ".png"]
    },
    "input": "https://example.com/images_many.zip"
  }
]
```

##### `audio_duration_too_long`

This error indicates that the provided audio file exceeds the maximum allowed duration.

* **Status Code:** 422
* **Retryable:** `false`.
* **Context (`ctx`):**
  * `max_duration`: The maximum allowed duration in seconds.
  * `provided_duration`: The duration of the provided audio file in seconds.

```json  theme={null}
[
  {
    "loc": ["body", "audio_file"],
    "msg": "Audio duration exceeds the maximum allowed. Maximum is 60 seconds, provided is 90 seconds.",
    "type": "audio_duration_too_long",
    "url": "https://docs.fal.ai/errors/#audio_duration_too_long",
    "ctx": {
      "max_duration": 60,
      "provided_duration": 90
    },
    "input": "https://example.com/long_audio.mp3"
  }
]
```

##### `audio_duration_too_short`

This error indicates that the provided audio file is shorter than the minimum required duration.

* **Status Code:** 422
* **Retryable:** `false`.
* **Context (`ctx`):**
  * `min_duration`: The minimum required duration in seconds.
  * `provided_duration`: The duration of the provided audio file in seconds.

```json  theme={null}
[
  {
    "loc": ["body", "audio_file"],
    "msg": "Audio duration is too short. Minimum is 5 seconds, provided is 2 seconds.",
    "type": "audio_duration_too_short",
    "url": "https://docs.fal.ai/errors/#audio_duration_too_short",
    "ctx": {
      "min_duration": 5,
      "provided_duration": 2
    },
    "input": "https://example.com/short_audio.mp3"
  }
]
```

##### `unsupported_audio_format`

This error indicates that the audio file format is not supported by the endpoint.

* **Status Code:** 422
* **Retryable:** `false`.
* **Context (`ctx`):**
  * `supported_formats`: A list of supported audio file extensions.

```json  theme={null}
[
  {
    "loc": ["body", "audio_file"],
    "msg": "Unsupported audio format. Supported formats are .mp3, .wav, .ogg.",
    "type": "unsupported_audio_format",
    "url": "https://docs.fal.ai/errors/#unsupported_audio_format",
    "ctx": {
      "supported_formats": [".mp3", ".wav", ".ogg"]
    },
    "input": "https://example.com/audio.midi"
  }
]
```

##### `unsupported_image_format`

This error indicates that the image file format is not supported by the endpoint.

* **Status Code:** 422
* **Retryable:** `false`.
* **Context (`ctx`):**
  * `supported_formats`: A list of supported image file extensions.

```json  theme={null}
[
  {
    "loc": ["body", "image"],
    "msg": "Unsupported image format. Supported formats are .jpg, .jpeg, .png, .webp.",
    "type": "unsupported_image_format",
    "url": "https://docs.fal.ai/errors/#unsupported_image_format",
    "ctx": {
      "supported_formats": [".jpg", ".jpeg", ".png", ".webp"]
    },
    "input": "https://example.com/image.tiff"
  }
]
```

##### `unsupported_video_format`

This error indicates that the video file format is not supported by the endpoint.

* **Status Code:** 422
* **Retryable:** `false`.
* **Context (`ctx`):**
  * `supported_formats`: A list of supported video file extensions.

```json  theme={null}
[
  {
    "loc": ["body", "video_file"],
    "msg": "Unsupported video format. Supported formats are .mp4, .mov, .webm.",
    "type": "unsupported_video_format",
    "url": "https://docs.fal.ai/errors/#unsupported_video_format",
    "ctx": {
      "supported_formats": [".mp4", ".mov", ".webm"]
    },
    "input": "https://example.com/video.avi"
  }
]
```

##### `video_duration_too_long`

This error indicates that the provided video file exceeds the maximum allowed duration.

* **Status Code:** 422
* **Retryable:** `false`.
* **Context (`ctx`):**
  * `max_duration`: The maximum allowed duration in seconds.
  * `provided_duration`: The duration of the provided video file in seconds.

```json  theme={null}
[
  {
    "loc": ["body", "video_file"],
    "msg": "Video duration exceeds the maximum allowed. Maximum is 60 seconds, provided is 120 seconds.",
    "type": "video_duration_too_long",
    "url": "https://docs.fal.ai/errors/#video_duration_too_long",
    "ctx": {
      "max_duration": 60,
      "provided_duration": 120
    },
    "input": "https://example.com/long_video.mp4"
  }
]
```

##### `video_duration_too_short`

This error indicates that the provided video file is shorter than the minimum required duration.

* **Status Code:** 422
* **Retryable:** `false`.
* **Context (`ctx`):**
  * `min_duration`: The minimum required duration in seconds.
  * `provided_duration`: The duration of the provided video file in seconds.

```json  theme={null}
[
  {
    "loc": ["body", "video_file"],
    "msg": "Video duration is too short. Minimum is 3 seconds, provided is 1 seconds.",
    "type": "video_duration_too_short",
    "url": "https://docs.fal.ai/errors/#video_duration_too_short",
    "ctx": {
      "min_duration": 3,
      "provided_duration": 1
    },
    "input": "https://example.com/short_video.mp4"
  }
]
```
