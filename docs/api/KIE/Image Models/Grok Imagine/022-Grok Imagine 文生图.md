# Grok Imagine 文生图

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
      summary: Grok Imagine 文生图
      deprecated: false
      description: >-
        ## 查询任务状态


        提交任务后，可通过统一的查询端点查看任务进度并获取生成结果：


        <Card title="获取任务详情" icon="lucide-search"
        href="/cn/market/common/get-task-detail">
          了解如何查询任务状态并获取生成结果
        </Card>


        ::: tip[]

        生产环境中，建议使用 `callBackUrl` 参数接收生成完成的自动通知，而非轮询状态端点。

        :::


        ## 相关资源


        <CardGroup cols={2}>
          <Card title="市场概览" icon="lucide-store" href="/cn/market/quickstart">
            浏览所有可用模型
          </Card>
          <Card title="通用 API" icon="lucide-cog" href="/cn/common-api/get-account-credits">
            查看账户积分与使用情况
          </Card>
        </CardGroup>
      operationId: grok-imagine-text-to-image
      tags:
        - docs/zh-CN/Market/Image    Models/Grok Imagine
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
                    - grok-imagine/text-to-image
                  default: grok-imagine/text-to-image
                  description: |-
                    用于生成的模型名称。必填字段。

                    - 此端点必须使用 `grok-imagine/text-to-image`
                  examples:
                    - grok-imagine/text-to-image
                callBackUrl:
                  type: string
                  format: uri
                  description: >-
                    接收图像生成任务完成更新的 URL。可选但建议在生产环境中使用。


                    - 当图像生成完成时，系统将向此 URL POST 任务状态和结果

                    - 回调包含生成的图像 URL 和任务信息

                    - 您的回调端点应接受包含图像结果的 JSON 负载的 POST 请求

                    - 或者，使用获取任务详情端点轮询任务状态

                    - 为确保回调安全性，请参阅 [Webhook
                    校验指南](/cn/common-api/webhook-verification) 了解签名验证实现方法
                  examples:
                    - https://your-domain.com/api/callback
                input:
                  type: object
                  description: 图像生成任务的输入参数
                  properties:
                    prompt:
                      type: string
                      description: |-
                        描述期望图像的文本提示。必填字段。

                        - 应该对期望的视觉元素详细具体
                        - 描述构图、风格、光线、情绪和其他视觉细节
                        - 最大长度：5000 字符
                        - 支持英文提示
                      examples:
                        - >-
                          一位女性坐在黑胶唱片机旁的电影肖像，复古客厅背景，柔和的环境照明，温暖的大地色调，怀旧的1970年代服装，沉思的情绪，柔和的胶片颗粒纹理，浅景深，复古编辑摄影风格。
                    aspect_ratio:
                      type: string
                      description: |-
                        指定生成图像的宽高比。控制输出的宽高比。

                        - **2:3**: 竖向（垂直）
                        - **3:2**: 横向（水平）
                        - **1:1**: 正方形
                        - **16:9**: 宽屏
                        - **9:16**: 竖屏

                        默认值：1:1
                      enum:
                        - '2:3'
                        - '3:2'
                        - '1:1'
                        - '16:9'
                        - '9:16'
                      examples:
                        - '3:2'
                    nsfw_checker:
                      type: boolean
                      default: false
                      description: >-
                        默认值为 false。您可以根据需要将其设置为 false。如果设置为
                        false，我们的内容过滤功能将被禁用，所有结果将由模型直接返回。
                    enable_pro:
                      type: boolean
                      description: |-
                        控制请求的处理策略。  
                          - `false`：对应 `speed` 模式，系统优先优化响应速度与吞吐量，适用于对延迟敏感的场景。  
                          - `true`：对应 `quality` 模式，系统优先保障任务处理质量与精度，适用于对结果要求较高的场景。
                  required:
                    - prompt
                  x-apidog-orders:
                    - prompt
                    - aspect_ratio
                    - nsfw_checker
                    - enable_pro
                  x-apidog-ignore-properties: []
              required:
                - model
                - input
              x-apidog-orders:
                - model
                - callBackUrl
                - input
              examples:
                - model: grok-imagine/text-to-image
                  callBackUrl: https://your-domain.com/api/callback
                  input:
                    prompt: >-
                      一位女性坐在黑胶唱片机旁的电影肖像，复古客厅背景，柔和的环境照明，温暖的大地色调，怀旧的1970年代服装，沉思的情绪，柔和的胶片颗粒纹理，浅景深，复古编辑摄影风格。
                    aspect_ratio: '3:2'
              x-apidog-ignore-properties: []
            example:
              model: grok-imagine/text-to-image
              callBackUrl: https://your-domain.com/api/callback
              input:
                prompt: >-
                  Cinematic portrait of a woman sitting by a vinyl record
                  player, retro living room background, soft ambient lighting,
                  warm earthy tones, nostalgic 1970s wardrobe, reflective mood,
                  gentle film grain texture, shallow depth of field, vintage
                  editorial photography style.
                aspect_ratio: '3:2'
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
                  taskId: task_grok_12345678
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
      x-apidog-folder: docs/zh-CN/Market/Image    Models/Grok Imagine
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-28506641-run
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
