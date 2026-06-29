# Wan - Flash 图转视频

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
      summary: Wan - Flash 图转视频
      deprecated: false
      description: |-
        > 使用 Wan 先进的 AI 模型将静态图像转换为动态视频

        ## 查询任务状态

        提交任务后，使用统一的查询端点检查进度并检索结果：
        <Card 
          title="获取任务详情" 
          icon="🔍" 
          href="/cn/market/common/get-task-detail"
        >
          了解如何查询任务状态和检索生成结果
        </Card>

        :::tip
        对于生产使用，我们建议使用 `callBackUrl` 参数接收生成完成时的自动通知，而不是轮询状态端点。
        :::

        ## 相关资源

        <CardGroup cols={2}>
          <Card 
            title="市场概览" 
            icon="🏪" 
            href="/cn/market/quickstart"
          >
            探索所有可用模型
          </Card>

          <Card 
            title="通用 API" 
            icon="⚙️" 
            href="/cn/common-api/get-account-credits"
          >
            检查积分和账户使用情况
          </Card>
        </CardGroup>
      operationId: wan-2-6-flash-image-to-video
      tags:
        - docs/zh-CN/Market/Video Models/Wan
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
                    - wan/2-6-flash-image-to-video
                  default: wan/2-6-flash-image-to-video
                  description: |-
                    用于生成的模型名称。必填字段。

                    - 此端点必须为 `wan/2-6-flash-image-to-video`
                  examples:
                    - wan/2-6-flash-image-to-video
                callBackUrl:
                  type: string
                  format: uri
                  description: >-
                    接收生成任务完成更新的 URL。生产环境可选但推荐使用。


                    - 系统会在生成完成时向此 URL 发送 POST 请求，包含任务状态和结果

                    - 回调包含生成的内容 URL 和任务信息

                    - 您的回调端点应接受包含 JSON 有效负载的 POST 请求

                    - 或者使用获取任务详情端点轮询任务状态

                    - 为确保回调安全性，请参阅 [Webhook
                    校验指南](/cn/common-api/webhook-verification) 了解签名验证实现方法
                  examples:
                    - https://your-domain.com/api/callback
                input:
                  type: object
                  description: 生成任务的输入参数
                  properties:
                    prompt:
                      description: 视频生成的文本提示。支持中文和英文，最少 2 个字符，最多 5,000 个字符。（最大长度：1500 个字符）
                      type: string
                      maxLength: 1500
                      examples:
                        - >-
                          Anthopmopric fox singing a Christmas song at the
                          rubbish dump in the rain.
                    image_urls:
                      description: >-
                        图片 URL 列表。所有图片至少为 256x256 像素。（上传后的文件
                        URL，非文件内容；接受类型：image/jpeg, image/png,
                        image/webp；最大大小：10.0MB）
                      type: array
                      items:
                        type: string
                        format: uri
                      maxItems: 1
                      examples:
                        - []
                    duration:
                      description: 生成视频的时长（秒）
                      type: string
                      enum:
                        - '5'
                        - '10'
                        - '15'
                      default: '5'
                      examples:
                        - '5'
                    resolution:
                      description: 视频分辨率等级
                      type: string
                      enum:
                        - 720p
                        - 1080p
                      default: 1080p
                      examples:
                        - 1080p
                    audio:
                      description: 是否生成带音频的视频。音频会直接影响费用，带声音与静音视频的计费不同。（布尔值 true/false）
                      type: boolean
                      examples:
                        - false
                    multi_shots:
                      description: >-
                        multi_shots 参数控制 AI
                        视频生成时的镜头构图风格，决定生成视频为单一连续镜头还是多镜头带转场。（布尔值 true/false）
                      type: boolean
                      examples:
                        - false
                  required:
                    - prompt
                    - image_urls
                    - audio
                  x-apidog-orders:
                    - prompt
                    - image_urls
                    - duration
                    - resolution
                    - audio
                    - multi_shots
                  x-apidog-ignore-properties: []
              x-apidog-orders:
                - model
                - callBackUrl
                - input
              x-apidog-ignore-properties: []
            example:
              model: wan/2-6-flash-image-to-video
              callBackUrl: https://your-domain.com/api/callback
              input:
                prompt: >-
                  Anthopmopric fox singing a Christmas song at the rubbish dump
                  in the rain.
                image_urls: []
                duration: '5'
                resolution: 1080p
                audio: false
                multi_shots: false
      responses:
        '200':
          description: 请求成功
          content:
            application/json:
              schema:
                allOf:
                  - $ref: '#/components/schemas/ApiResponse'
                  - type: object
                    properties:
                      data:
                        type: object
                        properties:
                          taskId:
                            type: string
                            description: 任务 ID，可与获取任务详情端点一起使用来查询任务状态
                            examples:
                              - task_wan_1772011327514
                        x-apidog-orders:
                          - taskId
                        x-apidog-ignore-properties: []
                    x-apidog-orders:
                      - data
                    x-apidog-ignore-properties: []
              example:
                code: 200
                msg: success
                data:
                  taskId: task_wan_1772011327514
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
      x-apidog-folder: docs/zh-CN/Market/Video Models/Wan
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-28595719-run
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
