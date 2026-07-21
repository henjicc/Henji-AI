# Volcengine 视频对口型

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
      summary: Volcengine 视频对口型
      deprecated: false
      description: >-
        ## 创建任务


        调用该接口可创建一个新的视频口型同步任务。上传一段视频和一段音频文件，模型将驱动视频中的口型与目标音频匹配。


        <Card title="查询任务详情" icon="lucide-search"
        href="/market/common/get-task-detail">
          提交任务后，可通过统一查询接口查看任务进度并获取生成结果
        </Card>


        ::: tip[]

        生产环境建议优先使用 `callBackUrl` 参数接收任务完成通知，而不是持续轮询任务状态接口。

        :::


        ## 文件上传


        ::: tip[]

        调用该接口前需要先上传文件？请参阅 [文件上传 API 快速入门](/file-upload-api/quickstart)。

        :::


        ## 输出规格


        生成的视频将以 MP4 格式返回，帧率为 25
        fps。最终输出视频时长以音频时长为准：如果原始视频长于音频，视频将被截断；如果原始视频短于音频，视频将循环播放。


        ## 相关资源


        <CardGroup cols={2}>
          <Card title="模型市场" icon="lucide-store" href="/market/quickstart">
            浏览全部可用模型与能力
          </Card>
          <Card title="通用 API" icon="lucide-cog" href="/common-api/get-account-credits">
            查看账户积分与调用情况
          </Card>
        </CardGroup>
      operationId: volcengine-video-to-video-lip-sync-zh
      tags:
        - docs/zh-CN/Market/Video Models/Volcengine
      parameters: []
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required:
                - model
                - input
              properties:
                model:
                  type: string
                  enum:
                    - volcengine/video-to-video-lip-sync
                  default: volcengine/video-to-video-lip-sync
                  description: |-
                    用于视频口型同步的模型名称。必填字段。

                    - 该端点必须使用 `volcengine/video-to-video-lip-sync` 模型
                  examples:
                    - volcengine/video-to-video-lip-sync
                input:
                  type: object
                  description: 视频口型同步任务的输入参数。
                  required:
                    - mode
                    - video_url
                    - audio_url
                  properties:
                    mode:
                      type: string
                      enum:
                        - lite
                        - basic
                      description: |-
                        口型同步生成的服务模式。
                        - `lite`：适用于单人正面视频，处理速度更快。
                        - `basic`：适用于单人复杂场景，支持场景分割和说话人识别。
                    video_url:
                      type: string
                      format: uri
                      description: >-
                        视频素材 URL。支持分辨率：360p–1080p。超过 1080p 的视频将自动压缩至 1080p，小于
                        360p
                        的视频暂不支持。支持格式：MOV、MP4、HDR。推荐编码：H.264。其他格式或编码可能会被转码。最大文件大小：500
                        MB。码率：1–30 Mbps。帧率：24–60 fps。
                    audio_url:
                      type: string
                      format: uri
                      description: >-
                        目标纯人声音频
                        URL；用于驱动视频口型运动。lite模式音频时长>1s&<=240s，basic模式音频时长>1s&<=210s。支持的文件类型：audio/mpeg、audio/wav、audio/x-wav、audio/aac、audio/mp4、audio/ogg。最大文件大小：10MB。
                    separate_vocal:
                      type: boolean
                      default: false
                      description: 是否启用人声分离以抑制背景噪音。默认值：`false`。
                    open_scenedet:
                      type: boolean
                      default: false
                      description: 是否启用场景分割和说话人识别。仅在 Basic 模式下支持。默认值：`false`。
                    align_audio:
                      type: boolean
                      default: true
                      description: Lite 模式下支持。当音频时长超过视频时长时，是否循环播放视频。默认值：`true`。
                    align_audio_reverse:
                      type: boolean
                      default: false
                      description: >-
                        Lite 模式下支持。是否倒序循环播放视频。需要 `align_audio` 设置为
                        `true`。默认值：`false`。
                    templ_start_seconds:
                      type: number
                      default: 0
                      description: Lite 模式下支持。模板视频的起始时间，单位为秒。默认值：`0`。
                  x-apidog-orders:
                    - mode
                    - video_url
                    - audio_url
                    - separate_vocal
                    - open_scenedet
                    - align_audio
                    - align_audio_reverse
                    - templ_start_seconds
                callBackUrl:
                  type: string
                  format: uri
                  description: 回调 URL。任务完成后，kie 会将结果发送到该业务回调地址。
              x-apidog-orders:
                - model
                - input
                - callBackUrl
            example:
              model: volcengine/video-to-video-lip-sync
              input:
                mode: lite
                video_url: https://your-domain.com/video/example.mp4
                audio_url: https://your-domain.com/audio/speech.mp3
                separate_vocal: false
                open_scenedet: false
                align_audio: true
                align_audio_reverse: false
                templ_start_seconds: 0
              callBackUrl: https://your-domain.com/api/callback
      responses:
        '200':
          description: 请求成功
          content:
            application/json:
              schema:
                allOf:
                  - type: object
                    properties: {}
                  - type: object
                    properties:
                      data:
                        type: object
                        properties:
                          taskId:
                            type: string
                            description: 任务 ID，可通过任务详情接口查询任务状态。
                            examples:
                              - >-
                                task_volcengine-video-to-video-lip-sync_1234567890
                        x-apidog-orders:
                          - taskId
                    x-apidog-orders:
                      - data
              example:
                code: 200
                msg: success
                data:
                  taskId: task_volcengine-video-to-video-lip-sync_1234567890
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
      x-apidog-folder: docs/zh-CN/Market/Video Models/Volcengine
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-37880921-run
components:
  schemas: {}
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
