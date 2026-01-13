# Kling Video v2.6 Motion Control

> Transfer movements from a reference video to any character image. Cost-effective mode for motion transfer, perfect for portraits and simple animations.

## Overview

- **Endpoint**: `https://fal.run/fal-ai/kling-video/v2.6/standard/motion-control`
- **Model ID**: `fal-ai/kling-video/v2.6/standard/motion-control`
- **Category**: video-to-video
- **Kind**: inference

## API Information

This model can be used via our HTTP API or more conveniently via our client libraries.

### Input Schema

The API accepts the following input parameters:

-   **`prompt`** (`string`, _optional_)
    -   Description: A text prompt describing the desired video content.
    -   Example: `"An african american woman dancing"`

-   **`image_url`** (`string`, _required_)
    -   Description: Reference image URL. The characters, backgrounds, and other elements in the generated video are based on this reference image. Characters should have clear body proportions, avoid occlusion, and occupy more than 5% of the image area.
    -   Example: `"https://v3b.fal.media/files/b/0a875302/8NaxQrQxDNHppHtqcchMm.png"`

-   **`video_url`** (`string`, _required_)
    -   Description: Reference video URL. The character actions in the generated video will be consistent with this reference video. Should contain a realistic style character with entire body or upper body visible, including head, without obstruction. Duration limit depends on `character_orientation`: 10s max for 'image', 30s max for 'video'.
    -   Example: `"https://v3b.fal.media/files/b/0a8752bc/2xrNS217ngQ3wzXqA7LXr_output.mp4"`

-   **`keep_original_sound`** (`boolean`, _optional_)
    -   Description: Whether to keep the original sound from the reference video.
    -   Default: `true`

-   **`character_orientation`** (`CharacterOrientationEnum`, _required_)
    -   Description: Controls whether the output character's orientation matches the reference image or video. `'video'`: orientation matches reference video - better for complex motions (max 30s). `'image'`: orientation matches reference image - better for following camera movements (max 10s).
    -   Options: `"image"`, `"video"`
    -   Example: `"video"`

**Required Parameters Example**:

```json
{
  "image_url": "https://v3b.fal.media/files/b/0a875302/8NaxQrQxDNHppHtqcchMm.png",
  "video_url": "https://v3b.fal.media/files/b/0a8752bc/2xrNS217ngQ3wzXqA7LXr_output.mp4",
  "character_orientation": "video"
}
```

**Full Request Example**:

```json
{
  "prompt": "An african american woman dancing",
  "image_url": "https://v3b.fal.media/files/b/0a875302/8NaxQrQxDNHppHtqcchMm.png",
  "video_url": "https://v3b.fal.media/files/b/0a8752bc/2xrNS217ngQ3wzXqA7LXr_output.mp4",
  "keep_original_sound": true,
  "character_orientation": "video"
}
```

### Output Schema

The API returns the following output format:

-   **`video`** (`File`, _required_):
    -   Description: The generated video file metadata.
    -   Example:
        ```json
        {
          "file_size": 35299865,
          "file_name": "output.mp4",
          "content_type": "video/mp4",
          "url": "https://v3b.fal.media/files/b/0a875336/8p3rFiXtx3fE2TLoh59KP_output.mp4"
        }
        ```

**Example Response**:

```json
{
  "video": {
    "file_size": 35299865,
    "file_name": "output.mp4",
    "content_type": "video/mp4",
    "url": "https://v3b.fal.media/files/b/0a875336/8p3rFiXtx3fE2TLoh59KP_output.mp4"
  }
}
```

## Usage Examples

### cURL

```bash
curl --request POST \
  --url https://fal.run/fal-ai/kling-video/v2.6/standard/motion-control \
  --header "Authorization: Key $FAL_KEY" \
  --header "Content-Type: application/json" \
  --data '{
     "image_url": "https://v3b.fal.media/files/b/0a875302/8NaxQrQxDNHppHtqcchMm.png",
     "video_url": "https://v3b.fal.media/files/b/0a8752bc/2xrNS217ngQ3wzXqA7LXr_output.mp4",
     "character_orientation": "video"
   }'
```

### Python

Ensure you have the Python client installed:

```bash
pip install fal-client
```

Then use the API client to make requests:

```python
import fal_client

def on_queue_update(update):
    if isinstance(update, fal_client.InProgress):
        for log in update.logs:
           print(log["message"])

result = fal_client.subscribe(
    "fal-ai/kling-video/v2.6/standard/motion-control",
    arguments={
        "image_url": "https://v3b.fal.media/files/b/0a875302/8NaxQrQxDNHppHtqcchMm.png",
        "video_url": "https://v3b.fal.media/files/b/0a8752bc/2xrNS217ngQ3wzXqA7LXr_output.mp4",
        "character_orientation": "video"
    },
    with_logs=True,
    on_queue_update=on_queue_update,
)
print(result)
```

### JavaScript

Ensure you have the JavaScript client installed:

```bash
npm install --save @fal-ai/client
```

Then use the API client to make requests:

```javascript
import { fal } from "@fal-ai/client";

const result = await fal.subscribe("fal-ai/kling-video/v2.6/standard/motion-control", {
  input: {
    image_url: "https://v3b.fal.media/files/b/0a875302/8NaxQrQxDNHppHtqcchMm.png",
    video_url: "https://v3b.fal.media/files/b/0a8752bc/2xrNS217ngQ3wzXqA7LXr_output.mp4",
    character_orientation: "video"
  },
  logs: true,
  onQueueUpdate: (update) => {
    if (update.status === "IN_PROGRESS") {
      update.logs.map((log) => log.message).forEach(console.log);
    }
  },
});
console.log(result.data);
console.log(result.requestId);
```

## Additional Resources

### Documentation

-   [Model Playground](https://fal.ai/models/fal-ai/kling-video/v2.6/standard/motion-control)
-   [API Documentation](https://fal.ai/models/fal-ai/kling-video/v2.6/standard/motion-control/api)
-   [OpenAPI Schema](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/kling-video/v2.6/standard/motion-control)

### fal.ai Platform

-   [Platform Documentation](https://docs.fal.ai)
-   [Python Client](https://docs.fal.ai/clients/python)
-   [JavaScript Client](https://docs.fal.ai/clients/javascript)