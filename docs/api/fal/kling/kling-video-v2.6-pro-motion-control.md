# Kling Video v2.6 Motion Control Pro

> Transfer movements from a reference video to any character image. Pro mode delivers higher quality output, ideal for complex dance moves and gestures.

## Overview

- **Endpoint**: `https://fal.run/fal-ai/kling-video/v2.6/pro/motion-control`
- **Model ID**: `fal-ai/kling-video/v2.6/pro/motion-control`
- **Category**: video-to-video
- **Kind**: inference

This model can be used via the HTTP API or the provided client libraries.

## Input Schema

The API accepts the following parameters:

- **`image_url`** (`string`, required): Reference image URL. The characters, backgrounds, and other elements in the generated video are based on this image. Characters should have clear body proportions, avoid occlusion, and occupy more than 5% of the image area.
    - Examples: `"https://v3b.fal.media/files/b/0a875302/8NaxQrQxDNHppHtqcchMm.png"`

- **`video_url`** (`string`, required): Reference video URL. The character actions in the generated video will match this video. Should contain a realistic style character with the entire body or upper body visible (including head), without obstruction. Duration limit depends on character_orientation: 10 seconds maximum for `'image'`, 30 seconds maximum for `'video'`.
    - Examples: `"https://v3b.fal.media/files/b/0a8752bc/2xrNS217ngQ3wzXqA7LXr_output.mp4"`

- **`character_orientation`** (`CharacterOrientationEnum`, required): Controls whether the output character's orientation matches the reference image or video.
    - Options: `"image"`, `"video"`
    - `"video"`: Orientation matches reference video – better for complex motions (max 30s).
    - `"image"`: Orientation matches reference image – better for following camera movements (max 10s).
    - Examples: `"video"`

- **`prompt`** (`string`, optional): A text description.
    - Examples: `"An african american woman dancing"`

- **`keep_original_sound`** (`boolean`, optional): Whether to keep the original sound from the reference video.
    - Default: `true`

### Input Examples

**Required Parameters**:

```json
{
  "image_url": "https://v3b.fal.media/files/b/0a875302/8NaxQrQxDNHppHtqcchMm.png",
  "video_url": "https://v3b.fal.media/files/b/0a8752bc/2xrNS217ngQ3wzXqA7LXr_output.mp4",
  "character_orientation": "video"
}
```

**Full Example**:

```json
{
  "prompt": "An african american woman dancing",
  "image_url": "https://v3b.fal.media/files/b/0a875302/8NaxQrQxDNHppHtqcchMm.png",
  "video_url": "https://v3b.fal.media/files/b/0a8752bc/2xrNS217ngQ3wzXqA7LXr_output.mp4",
  "keep_original_sound": true,
  "character_orientation": "video"
}
```

## Output Schema

The API returns the following object:

- **`video`** (`File`, required): The generated video.
    - Examples: `{"file_size": 35299865, "file_name": "output.mp4", "content_type": "video/mp4", "url": "https://v3b.fal.media/files/b/0a875336/8p3rFiXtx3fE2TLoh59KP_output.mp4"}`

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
  --url https://fal.run/fal-ai/kling-video/v2.6/pro/motion-control \
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
    "fal-ai/kling-video/v2.6/pro/motion-control",
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

const result = await fal.subscribe("fal-ai/kling-video/v2.6/pro/motion-control", {
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

- [Model Playground](https://fal.ai/models/fal-ai/kling-video/v2.6/pro/motion-control)
- [API Documentation](https://fal.ai/models/fal-ai/kling-video/v2.6/pro/motion-control/api)
- [OpenAPI Schema](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/kling-video/v2.6/pro/motion-control)
- [Platform Documentation](https://docs.fal.ai)
- [Python Client](https://docs.fal.ai/clients/python)
- [JavaScript Client](https://docs.fal.ai/clients/javascript)