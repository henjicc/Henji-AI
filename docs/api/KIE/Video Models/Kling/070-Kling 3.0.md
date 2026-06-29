# Kling 3.0

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /api/v1/jobs/createTask:
    post:
      summary: Kling 3.0
      deprecated: false
      description: >-
        使用 Kling 3.0 AI 模型生成具有高级多镜头功能和元素引用的高质量视频。


        ## 概述


        Kling 3.0
        是一个先进的视频生成模型，支持单镜头和多镜头视频创作，并支持元素引用功能。它提供两种生成模式（标准版和专业版）以及不同的分辨率选项，并支持音效以增强视频输出。


        ## 主要特性


        - **多种生成模式**：可在 `std`（标准分辨率）、`pro`（更高分辨率）和 `4K`（超高分辨率）模式之间选择

        - **多镜头支持**：创建包含多个镜头的视频，每个镜头都有自己的提示词和时长

        - **元素引用**：使用 `@element_name` 语法在提示词中引用图像/视频/音频元素

        - **音效**：可选的音效以增强视频输出

        - **灵活的宽高比**：支持 16:9、9:16 和 1:1 宽高比

        - **可配置时长**：视频时长从 3 到 15 秒


        ## 分辨率映射


        分辨率取决于 `mode` 和 `aspect_ratio` 参数：


        <Tabs groupId="mode">

        <TabItem value="std" label="标准模式 (std)">


        | 宽高比 | 分辨率 |

        |--------|--------|

        | 16:9   | 1280×720 |

        | 9:16   | 720×1280 |

        | 1:1    | 720×720 |


        </TabItem>

        <TabItem value="pro" label="专业模式 (pro)">


        | 宽高比 | 分辨率 |

        |--------|--------|

        | 16:9   | 1920×1080 |

        | 9:16   | 1080×1920 |

        | 1:1    | 1080×1080 |


        </TabItem>

        <TabItem value="4K" label="4K模式 (4K)">


        | 宽高比 | 分辨率 |

        |--------|--------|

        | 16:9   | 3840×2160 |

        | 9:16   | 2160×3840 |

        | 1:1    | 2160×2160 |


        </TabItem>

        </Tabs>


        :::info[]

        4K模式提供更高分辨率的输出，但可能需要更长的生成时间并消耗更多积分。

        :::


        ## 单镜头与多镜头模式


        ### 单镜头模式 (`multi_shots: false`)


        - 使用主 `prompt` 字段进行视频生成

        - 通过 `image_urls` 支持首帧和尾帧图像

        - 音效为可选


        ### 多镜头模式 (`multi_shots: true`)


        - 使用 `multi_prompt` 数组定义多个镜头

        - 每个镜头有自己的提示词和时长（1-12 秒）

        - 仅支持首帧图像（通过 `image_urls[0]`）

        - 音效默认为启用

        - 每个镜头最大字符数为500


        ## 元素引用


        您可以使用 `@element_name` 语法在提示词中引用元素。在 `kling_elements` 数组中定义元素：


        - **图像元素**：2-4 个图像 URL（JPG/PNG，每个最大 10MB）

        - **视频元素**：最多上传 1个视频 URL（MP4/MOV，视频时长需大于等于 3 秒，有效片段长度需保持在 3-8 秒）

        - **音频参考**：最多上传 1 个音频 URL（音频时长必须为 5-30 秒）


        :::info[]

        使用描述性的元素名称，并确保 `kling_elements` 中的元素名称与提示词中使用的名称匹配（不带 @ 符号）。

        单个任务最多引用3个元素，且每个@element占37个字符。

        :::


        ## 文件上传要求


        在使用元素引用之前，请上传您的图像：


        ### 1. 上传文件


        使用文件上传 API 上传您的源图像。


        :::info[文件上传 API]

        了解如何上传文件并获取文件 URL，请参阅 [文件上传 API 快速入门](/cn/file-upload-api/quickstart)。

        :::


        ### 2. 获取文件 URL


        上传后，您将收到可用于 `element_input_urls` 和 `element_input_audio_urls`  的文件 URL。


        :::caution

        - **格式**：
            - 图片（JPG、PNG，每个文件最大 10MB，每个元素 2-4 个文件）
            - 视频（MP4、MOV，视频时长需大于等于 3 秒，有效片段长度需保持在 3-8 秒）
            - 音频（音频时长必须为 5-30 秒）
        - 确保文件 URL 可访问且未过期

        :::


        ## 使用示例


        ### 带元素引用的单镜头视频


        ```json

        {
          "model": "kling-3.0/video",
          "input": {
            "prompt": "In a bright rehearsal room, sunlight streams through the window@element_dog",
            "image_urls": [
              "https://static.aiquickdraw.com/tools/example/1764851002741_i0lEiI8I.png"
            ],
            "sound": true,
            "duration": "5",
            "aspect_ratio": "16:9",
            "mode": "pro",
            "multi_shots": false,
            "kling_elements": [
              {
                "name": "element_dog",
                "description": "dog",
                "element_input_urls": [
                  "https://tempfileb.aiquickdraw.com/kieai/market/1770361808044_4RfUUJrI.jpeg",
                  "https://tempfileb.aiquickdraw.com/kieai/market/1770361848336_ABQqRHBi.png"
                ]
              }
            ]
          }
        }

        ```


        ### 多镜头视频


        ```json

        {
          "model": "kling-3.0/video",
          "input": {
            "multi_shots": true,
            "image_urls": [
              "https://static.aiquickdraw.com/tools/example/1764851002741_i0lEiI8I.png"
            ],
            "duration": "5",
            "aspect_ratio": "16:9",
            "mode": "pro",
            "multi_prompt": [
              {
                "prompt": "a happy dog in running @element_cat",
                "duration": 3
              },
              {
                "prompt": "a happy dog play with a cat @element_dog",
                "duration": 3
              }
            ],
            "kling_elements": [
              {
                "name": "element_cat",
                "description": "cat",
                "element_input_urls": [
                  "https://your-cdn.com/element_image.jpg",
                  "https://your-cdn.com/element_image2.jpg"
                ]
              },
              {
                "name": "element_dog",
                "description": "dog",
                "element_input_urls": [
                  "https://tempfileb.aiquickdraw.com/kieai/market/1770361808044_4RfUUJrI.jpeg",
                  "https://tempfileb.aiquickdraw.com/kieai/market/1770361808044_4RfUUJrI.jpeg"
                ]
              }
            ]
          }
        }

        ```


        ## 查询任务状态


        提交任务后，使用统一查询端点检查进度并检索结果：


        :::tip[获取任务详情]

        了解如何查询任务状态和检索生成结果，请参阅 [获取任务详情](/cn/market/common/get-task-detail)。

        :::


        :::tip[]

        对于生产环境使用，我们建议使用 `callBackUrl` 参数在生成完成时接收自动通知，而不是轮询状态端点。

        :::


        ## 最佳实践


        - **提示词编写**：在提示词中具体且详细。包括关于运动、相机角度和场景构图的细节

        - **元素使用**：使用高质量的参考图像/视频/音频以获得更好的效果。确保元素与视频的风格和主题匹配

        - **时长规划**：对于多镜头视频，规划镜头时长以匹配总视频时长

        - **模式选择**：当质量重要时使用 `4K` 模式进行最终输出，在需要快速迭代时使用 `std` 模式

        - **音效**：为更具沉浸感的视频启用音效，特别是动作或动态场景


        ## 相关资源


        <CardGroup cols={2}>
          <Card title="市场概览" icon="lucide-store" href="/cn/market/quickstart">
          </Card>
          <Card title="通用 API" icon="lucide-cog" href="/cn/common-api/get-account-credits">
          </Card>
        </CardGroup>
      operationId: kling-3.0
      tags:
        - docs/zh-CN/Market/Video Models/Kling
      parameters: []
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required:
                - model
              properties:
                model:
                  type: string
                  enum:
                    - kling-3.0/video
                  default: kling-3.0/video
                  description: |-
                    用于生成任务的模型名称。必填字段。

                    - 该接口必须使用 `kling-3.0/video` 模型
                  examples:
                    - kling-3.0/video
                callBackUrl:
                  type: string
                  format: uri
                  description: >-
                    接收生成任务完成通知的回调 URL。可选配置，生产环境建议使用。


                    - 任务生成完成后，系统会向该 URL 以 POST 方式推送任务状态和结果

                    - 回调内容包含生成内容的 URL 及任务相关信息

                    - 你的回调接口需支持接收 POST 请求及 JSON 格式的请求体

                    - 也可选择调用任务详情接口，主动轮询任务状态

                    - 为确保回调安全性，请参阅 [Webhook
                    校验指南](/cn/common-api/webhook-verification) 了解签名验证实现方法
                  examples:
                    - https://your-domain.com/api/callback
                input:
                  type: object
                  description: 生成任务的输入参数
                  properties:
                    prompt:
                      type: string
                      description: 视频生成提示词。当 multi_shots 为 false 时生效。
                      examples:
                        - >-
                          In a bright rehearsal room, sunlight streams through
                          the window@element_dog
                    image_urls:
                      type: array
                      items:
                        type: string
                        format: uri
                      description: >-
                        首尾帧图片链接。可选。当 multi_shots 为 false 时：长度为 2 时，索引 0 为首帧，索引 1
                        为尾帧；长度为 1 时，数组项作为首帧。当 multi_shots 为 true 时：只支持首帧。
                      examples:
                        - - >-
                            https://static.aiquickdraw.com/tools/example/1764851002741_i0lEiI8I.png
                    sound:
                      type: boolean
                      description: >-
                        是否开启音效。true 为开启音效，false 为关闭。当 multi_shots 为 true
                        时，字段值默认为 true。
                      default: false
                      examples:
                        - true
                    duration:
                      type: string
                      description: 视频总时长。单位：秒。范围：3 到 15，整数。
                      enum:
                        - '3'
                        - '4'
                        - '5'
                        - '6'
                        - '7'
                        - '8'
                        - '9'
                        - '10'
                        - '11'
                        - '12'
                        - '13'
                        - '14'
                        - '15'
                      default: '5'
                      examples:
                        - '5'
                    aspect_ratio:
                      type: string
                      description: 视频比例。可选：16:9、9:16、1:1
                      enum:
                        - '16:9'
                        - '9:16'
                        - '1:1'
                      default: '16:9'
                      examples:
                        - '16:9'
                    mode:
                      type: string
                      description: >-
                        生成模式。std 为标准分辨率，pro 为高分辨率，4K 为 4K 分辨率。


                        分辨率映射：

                        - **std 模式**：16:9 (1280×720), 9:16 (720×1280), 1:1
                        (720×720)

                        - **pro 模式**：16:9 (1920×1080), 9:16 (1080×1920), 1:1
                        (1080×1080)

                        - **4K 模式**：16:9 (3840×2160), 9:16 (2160×3840), 1:1
                        (2160×2160)
                      enum:
                        - std
                        - pro
                        - 4K
                      default: pro
                      examples:
                        - pro
                      x-apidog-enum:
                        - value: std
                          name: ''
                          description: ''
                        - value: pro
                          name: ''
                          description: ''
                        - value: 4K
                          name: ''
                          description: ''
                    multi_shots:
                      type: boolean
                      description: 是否多镜头。true 时为多镜头，false 为单镜头。
                      default: false
                      examples:
                        - false
                    multi_prompt:
                      type: array
                      description: >-
                        镜头提示词。multi_shots 为 true 时生效。用来描述每一段镜头的文案和时长，最多支持 5
                        段，每段时长 1-12 秒，如果需要使用 element，则需加在 prompt 后。
                      items:
                        type: object
                        properties:
                          prompt:
                            type: string
                            description: 该镜头的提示词文本，单个镜头最多500字符，每个@element会占37个字符。
                            examples:
                              - a happy dog in running@element_cat
                            maxLength: 500
                          duration:
                            type: integer
                            description: 该镜头的时长（单位：秒）。范围：1-12。
                            minimum: 1
                            maximum: 12
                            examples:
                              - 3
                        required:
                          - prompt
                          - duration
                        x-apidog-orders:
                          - prompt
                          - duration
                        x-apidog-ignore-properties: []
                      examples:
                        - - prompt: a happy dog in running@element_cat
                            duration: 3
                          - prompt: a happy dog play with a cat@element_dog
                            duration: 3
                    kling_elements:
                      type: array
                      items:
                        type: object
                        properties:
                          name:
                            type: string
                            description: 元素名称，在 prompt 中使用 @ 前缀引用（如 @element_dog）
                            examples:
                              - element_dog
                          description:
                            type: string
                            description: 元素描述
                            examples:
                              - dog
                          element_input_urls:
                            type: array
                            items:
                              type: string
                              format: uri
                            description: >-
                              元素的图片链接。需要 2-4 个 URL。支持格式：JPG、PNG。最大文件大小：每张图片
                              10MB。
                            examples:
                              - - >-
                                  https://tempfileb.aiquickdraw.com/kieai/market/1770361808044_4RfUUJrI.jpeg
                                - >-
                                  https://tempfileb.aiquickdraw.com/kieai/market/1770361848336_ABQqRHBi.png
                          element_input_audio_urls:
                            type: array
                            items:
                              type: string
                              format: uri
                            description: 可选。角色音频素材 URL 列表。音频时长必须为 5-30 秒
                          start_time:
                            type: integer
                            description: >-
                              视频角色素材截取开始时间，单位毫秒。仅 element_input_urls
                              上传视频时生效。未传时默认 0。
                            default: 0
                          end_time:
                            type: integer
                            description: >-
                              视频角色素材截取结束时间，单位毫秒。仅 element_input_urls
                              上传视频时生效。必须大于 start_time，且 end_time - start_time
                              必须在 3000-8000ms。
                            default: 8000
                        required:
                          - name
                          - description
                          - element_input_urls
                        x-apidog-orders:
                          - name
                          - description
                          - element_input_urls
                          - element_input_audio_urls
                          - start_time
                          - end_time
                        x-apidog-ignore-properties: []
                      description: 引用元素。prompt 中引用元素的详细信息。单个任务最多引用三个元素。
                      examples:
                        - - name: element_dog
                            description: dog
                            element_input_urls:
                              - >-
                                https://tempfileb.aiquickdraw.com/kieai/market/1770361808044_4RfUUJrI.jpeg
                              - >-
                                https://tempfileb.aiquickdraw.com/kieai/market/1770361848336_ABQqRHBi.png
                          - name: element_cat
                            description: cat
                            element_input_urls:
                              - >-
                                https://tempfileb.aiquickdraw.com/kieai/market/1770361808044_4RfUUJrI.jpeg
                              - >-
                                https://tempfileb.aiquickdraw.com/kieai/market/1770361848336_ABQqRHBi.png
                      maxItems: 3
                  required:
                    - prompt
                    - sound
                    - duration
                    - aspect_ratio
                    - mode
                    - multi_shots
                    - multi_prompt
                    - kling_elements
                  x-apidog-orders:
                    - prompt
                    - image_urls
                    - sound
                    - duration
                    - aspect_ratio
                    - mode
                    - multi_shots
                    - multi_prompt
                    - kling_elements
                  x-apidog-ignore-properties: []
              x-apidog-orders:
                - model
                - callBackUrl
                - input
              x-apidog-ignore-properties: []
            example:
              model: kling-3.0/video
              callBackUrl: https://your-domain.com/api/callback
              input:
                prompt: >-
                  In a bright rehearsal room, sunlight streams through the
                  window@element_dog
                image_urls:
                  - >-
                    https://static.aiquickdraw.com/tools/example/1764851002741_i0lEiI8I.png
                sound: true
                duration: '5'
                aspect_ratio: '16:9'
                mode: pro
                multi_shots: false
                multi_prompt:
                  - prompt: a happy dog in running@element_cat
                    duration: 3
                  - prompt: a happy dog play with a cat@element_dog
                    duration: 3
                kling_elements:
                  - name: element_dog
                    description: dog
                    element_input_urls:
                      - >-
                        https://tempfileb.aiquickdraw.com/kieai/market/1770361808044_4RfUUJrI.jpeg
                      - >-
                        https://tempfileb.aiquickdraw.com/kieai/market/1770361848336_ABQqRHBi.png
                    element_input_audio_urls:
                      - https://your-cdn.com/wjeoiajfosijfoi.mp3
                  - name: element_cat
                    description: cat
                    element_input_urls:
                      - https://your-cdn.com/element_image.mp4
                    element_input_audio_urls:
                      - https://your-cdn.com/wjeoiajfosijfoi.mp3
                    start_time: 0
                    end_time: 8000
      responses:
        '200':
          description: 请求成功
          content:
            application/json:
              schema:
                allOf:
                  - $ref: '#/components/schemas/ApiResponse'
              example:
                code: 200
                msg: success
                data:
                  taskId: task_kling-3.0_1765187774173
          headers: {}
          x-apidog-name: ''
      security:
        - BearerAuth: []
          x-apidog:
            schemeGroups:
              - id: kn8M4YUlc5i0A0179ezwx
                schemeIds:
                  - BearerAuth
            required: true
            use:
              id: kn8M4YUlc5i0A0179ezwx
            scopes:
              kn8M4YUlc5i0A0179ezwx:
                BearerAuth: []
      x-apidog-folder: docs/zh-CN/Market/Video Models/Kling
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-28506669-run
components:
  schemas:
    ApiResponse:
      type: object
      properties:
        code:
          type: integer
          description: |-
            响应状态码
            200: 成功 - 请求已成功处理
            401: 未授权 - 缺少身份验证凭据或凭据无效
            402: 额度不足 - 账户额度不足，无法执行该操作
            404: 未找到 - 请求的资源或接口不存在
            422: 校验错误 - 请求参数未通过校验检查
            429: 请求受限 - 已超过该资源的请求频率限制
            433: 请求限额 - 子 key 使用超出限额
            455: 服务不可用 - 系统目前正在维护中
            500: 服务器错误 - 处理请求时发生了意外错误
            501: 生成失败 - 内容生成任务失败
            505: 功能禁用 - 请求的功能目前已禁用
          enum:
            - 200
            - 401
            - 402
            - 404
            - 422
            - 429
            - 433
            - 455
            - 500
            - 501
            - 505
          x-apidog-enum:
            - value: 200
              name: ''
              description: ''
            - value: 401
              name: ''
              description: ''
            - value: 402
              name: ''
              description: ''
            - value: 404
              name: ''
              description: ''
            - value: 422
              name: ''
              description: ''
            - value: 429
              name: ''
              description: ''
            - value: 433
              name: ''
              description: ''
            - value: 455
              name: ''
              description: ''
            - value: 500
              name: ''
              description: ''
            - value: 501
              name: ''
              description: ''
            - value: 505
              name: ''
              description: ''
        msg:
          type: string
          description: 响应消息，失败时的错误描述
        data:
          type: object
          properties:
            taskId:
              type: string
              description: 任务 ID 可与“获取任务详细信息”端点一起使用，以查询任务状态
          x-apidog-orders:
            - taskId
          required:
            - taskId
          x-apidog-ignore-properties: []
      x-apidog-orders:
        - code
        - msg
        - data
      required:
        - code
        - msg
        - data
      title: response not with recordId
      x-apidog-ignore-properties: []
      x-apidog-folder: ''
  securitySchemes:
    BearerAuth:
      type: bearer
      scheme: bearer
      bearerFormat: API Key
      description: >-
        All API requests require a Bearer Token. Add the header `Authorization:
        Bearer YOUR_API_KEY` to authenticate requests.
    BearerAuth1:
      type: bearer
      scheme: bearer
      bearerFormat: API Key
      description: >-
        所有 API 请求都需要 Bearer Token。请在请求头中添加 `Authorization: Bearer YOUR_API_KEY`
        进行身份验证。
servers:
  - url: https://api.kie.ai
    description: 正式环境
security:
  - BearerAuth: []
    x-apidog:
      schemeGroups:
        - id: kn8M4YUlc5i0A0179ezwx
          schemeIds:
            - BearerAuth
      required: true
      use:
        id: kn8M4YUlc5i0A0179ezwx
      scopes:
        kn8M4YUlc5i0A0179ezwx:
          BearerAuth: []

```
