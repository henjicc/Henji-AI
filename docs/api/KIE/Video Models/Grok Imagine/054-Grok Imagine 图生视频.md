# Grok Imagine 图生视频

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
      summary: Grok Imagine 图生视频
      deprecated: false
      description: >
        ## 查询任务状态


        提交任务后，使用统一的查询端点检查进度并获取结果：


        <Card title="获取任务详情" icon="lucide-search"
        href="/cn/market/common/get-task-detail">
          了解如何查询任务状态并获取生成结果
        </Card>


        ::: tip[]

        对于生产环境，我们建议使用 `callBackUrl` 参数接收自动通知，而不是轮询状态端点。

        :::


        ## 相关资源


        <CardGroup cols={2}>
          <Card title="市场概览" icon="lucide-store" href="/cn/market/quickstart">
            探索所有可用模型
          </Card>
          <Card title="通用API" icon="lucide-cog" href="/cn/common-api/get-account-credits">
            查看积分和账户使用情况
          </Card>
        </CardGroup>
      operationId: grok-imagine-image-to-video
      tags:
        - docs/zh-CN/Market/Video Models/Grok Imagine
      parameters: []
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                model:
                  type: string
                  enum:
                    - grok-imagine/image-to-video
                  default: grok-imagine/image-to-video
                  description: |-
                    用于生成的模型名称。必填字段。

                    - 此端点必须使用 `grok-imagine/image-to-video`
                  examples:
                    - grok-imagine/image-to-video
                callBackUrl:
                  type: string
                  format: uri
                  description: |-
                    接收视频生成任务完成更新的 URL。可选但建议在生产环境中使用。

                    - 当视频生成完成时，系统将向此 URL POST 任务状态和结果
                    - 回调包含生成的视频 URL 和任务信息
                    - 您的回调端点应接受包含视频结果的 JSON 负载的 POST 请求
                    - 或者，使用获取任务详情端点轮询任务状态
                  examples:
                    - https://your-domain.com/api/callback
                input:
                  type: object
                  description: 视频生成任务的输入参数
                  properties:
                    image_urls:
                      type: array
                      items:
                        type: string
                        format: uri
                      description: >-
                        提供一个外部图像 URL 作为视频生成的参考。支持最多7个图像，不要与 task_id
                        同时使用。在提示词中引用已上传图片时，请输入 @image(n)，并在其后加一个空格（例如：@image1
                        海边日落）。


                        - 支持 JPEG、PNG、WEBP 格式

                        - 每张图像最大文件大小：10MB

                        - 使用外部图像时 Spicy 模式不可用

                        - 数组最多包含七个 URL
                      maxItems: 7
                      examples:
                        - - >-
                            https://file.aiquickdraw.com/custom-page/akr/section-images/1762247692373tw5di116.png
                    task_id:
                      type: string
                      description: >-
                        之前生成的 Grok 图像的任务 ID。与 index 配合使用选择特定图像，不要与 image_urls
                        同时使用。


                        - 使用 grok-imagine/text-to-image 生成的任务 ID

                        - 支持所有模式，包括 Spicy

                        - 最大长度：100 字符
                      maxLength: 100
                      examples:
                        - task_grok_12345678
                    index:
                      type: integer
                      description: |-
                        使用 task_id 时，指定使用哪个图像（Grok 每次生成 6 张图像）。仅与 task_id 配合使用。

                        - 基于 0 的索引 (0-5)
                        - 如果提供了 image_urls 则忽略此参数
                        - 默认值：0
                      minimum: 0
                      maximum: 5
                      default: 0
                      examples:
                        - 0
                    prompt:
                      type: string
                      description: |-
                        描述期望视频运动的文本提示。可选字段。

                        - 应该对期望的视觉运动详细具体
                        - 描述运动、动作序列、摄影工作和时间安排
                        - 包含主体、环境和运动动态的细节
                        - 最大长度：5000 字符
                        - 支持英文提示
                      examples:
                        - >-
                          POV hand comes into frame handing the girl a cup of
                          take away coffee, the girl steps out of the screen
                          looking tired, then takes it and she says happily:
                          "thanks! Back to work" she exits the frame and walks
                          right to a different part of the office.
                    mode:
                      type: string
                      description: |-
                        指定影响运动风格和强度的生成模式。注意：外部图像输入不支持 Spicy 模式。

                        - **fun**: 更有创意和趣味的解读
                        - **normal**: 平衡方法，具有良好的运动质量
                        - **spicy**: 更有活力和强烈的运动效果（外部图像不可用）

                        默认值：normal
                      enum:
                        - fun
                        - normal
                        - spicy
                      default: normal
                      examples:
                        - normal
                    duration:
                      type: number
                      description: 生成的视频时长（秒）（6-30）。（最小值：6，最大值：30，步长：1）
                    resolution:
                      type: string
                      description: 生成视频的分辨率。
                      enum:
                        - 480p
                        - 720p
                      x-apidog-enum:
                        - value: 480p
                          name: ''
                          description: ''
                        - value: 720p
                          name: ''
                          description: ''
                      default: 480p
                      examples:
                        - 480p
                    aspect_ratio:
                      type: string
                      description: 图像比例选择，仅适用于多图生成模式，单图模式下视频宽高参考图片宽高。
                      enum:
                        - '2:3'
                        - '3:2'
                        - '1:1'
                        - '16:9'
                        - '9:16'
                      x-apidog-enum:
                        - value: '2:3'
                          name: ''
                          description: ''
                        - value: '3:2'
                          name: ''
                          description: ''
                        - value: '1:1'
                          name: ''
                          description: ''
                        - value: '16:9'
                          name: ''
                          description: ''
                        - value: '9:16'
                          name: ''
                          description: ''
                      default: '16:9'
                    nsfw_checker:
                      type: boolean
                      default: false
                      description: >-
                        默认值为 false。您可以根据需要将其设置为 false。如果设置为
                        false，我们的内容过滤功能将被禁用，所有结果将由模型直接返回。
                  x-apidog-orders:
                    - image_urls
                    - task_id
                    - index
                    - prompt
                    - mode
                    - duration
                    - resolution
                    - aspect_ratio
                    - nsfw_checker
                  x-apidog-ignore-properties: []
              required:
                - model
                - input
              x-apidog-orders:
                - model
                - callBackUrl
                - input
              examples:
                - model: grok-imagine/image-to-video
                  callBackUrl: https://your-domain.com/api/callback
                  input:
                    image_urls:
                      - >-
                        https://file.aiquickdraw.com/custom-page/akr/section-images/1762247692373tw5di116.png
                    prompt: >-
                      POV hand comes into frame handing the girl a cup of take
                      away coffee, the girl steps out of the screen looking
                      tired, then takes it and she says happily: "thanks! Back
                      to work" she exits the frame and walks right to a
                      different part of the office.
                    mode: normal
              x-apidog-ignore-properties: []
            example:
              model: grok-imagine/image-to-video
              callBackUrl: https://your-domain.com/api/callback
              input:
                task_id: task_grok_12345678
                image_urls:
                  - >-
                    https://file.aiquickdraw.com/custom-page/akr/section-images/1762247692373tw5di116.png
                prompt: >-
                  POV hand comes into frame handing the girl a cup of take away
                  coffee, the girl steps out of the screen looking tired, then
                  takes it and she says happily: "thanks! Back to work" she
                  exits the frame and walks right to a different part of the
                  office.
                mode: normal
                duration: '6'
                resolution: 480p
                aspect_ratio: '16:9'
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
                  taskId: 281e5b0*********************f39b9
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
      x-apidog-folder: docs/zh-CN/Market/Video Models/Grok Imagine
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-28506657-run
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
