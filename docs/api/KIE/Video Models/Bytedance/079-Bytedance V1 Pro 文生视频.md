# Bytedance V1 Pro 文生视频

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
      summary: Bytedance V1 Pro 文生视频
      deprecated: false
      description: >-
        ## 查询任务状态


        提交任务后，可通过统一的查询接口查看任务进度并获取结果：


        <Card title="Get Task Details" icon="magnifying-glass"
        href="/cn/market/common/get-task-detail">
          了解如何查询任务状态并获取生成结果
        </Card>


        ::: tip[]

        生产环境中，建议使用 `callBackUrl` 参数接收生成完成的自动通知，而非轮询状态接口。

        :::


        ## 相关资源


        <CardGroup cols={2}>
          <Card title="Market Overview" icon="store" href="/cn/market/quickstart">
            浏览所有可用模型
          </Card>
          <Card title="Common API" icon="gear" href="/cn/common-api/get-account-credits">
            查看账户积分与使用情况
          </Card>
        </CardGroup>
      operationId: bytedance-v1-pro-text-to-video
      tags:
        - docs/zh-CN/Market/Video Models/Bytedance
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
                    - bytedance/v1-pro-text-to-video
                  default: bytedance/v1-pro-text-to-video
                  description: |-
                    用于生成任务的模型名称。必填字段。

                    - 该接口必须使用 `bytedance/v1-pro-text-to-video` 模型
                  examples:
                    - bytedance/v1-pro-text-to-video
                callBackUrl:
                  type: string
                  format: uri
                  description: |-
                    接收生成任务完成通知的回调 URL。可选配置，生产环境建议使用。

                    - 任务生成完成后，系统会向该 URL 以 POST 方式推送任务状态和结果
                    - 回调内容包含生成内容的 URL 及任务相关信息
                    - 你的回调接口需支持接收 POST 请求及 JSON 格式的请求体
                    - 也可选择调用任务详情接口，主动轮询任务状态
                  examples:
                    - https://your-domain.com/api/callback
                input:
                  type: object
                  description: 生成任务的输入参数
                  properties:
                    prompt:
                      description: 用于视频生成的文本提示词（最大长度：10000 字符）
                      type: string
                      maxLength: 10000
                      examples:
                        - |-
                          日落时分，一个卷头发、背着书包的男孩骑着自行车行驶在洒满金光的乡间小路上。
                          【切镜】他放慢车速，望向一片高高的草地。
                          【广角镜头】他的剪影停驻在橘色的薄雾中。
                    aspect_ratio:
                      description: 生成视频的宽高比
                      type: string
                      enum:
                        - '21:9'
                        - '16:9'
                        - '4:3'
                        - '1:1'
                        - '3:4'
                        - '9:16'
                      default: '16:9'
                      examples:
                        - '16:9'
                    resolution:
                      description: 视频分辨率 - 480p 生成速度更快，720p 兼顾速度与画质，1080p 画质更高
                      type: string
                      enum:
                        - 480p
                        - 720p
                        - 1080p
                      default: 720p
                      examples:
                        - 720p
                    duration:
                      description: 视频时长（单位：秒）
                      type: string
                      enum:
                        - '5'
                        - '10'
                      default: '5'
                      examples:
                        - '5'
                    camera_fixed:
                      description: 是否固定相机位置（布尔值（true/false））
                      type: boolean
                      examples:
                        - false
                    seed:
                      description: 用于控制视频生成的随机种子值。设为 -1 时随机生成。（最小值：-1，最大值：2147483647，步长：1）
                      type: number
                      minimum: -1
                      maximum: 2147483647
                      default: -1
                      examples:
                        - -1
                    enable_safety_checker:
                      description: >-
                        Playground 环境下安全校验始终启用。仅可通过 API 将该参数设为 false
                        以关闭安全校验。（布尔值（true/false））
                      type: boolean
                      examples:
                        - true
                    nsfw_checker:
                      type: boolean
                      description: >-
                        默认值为 false。您可以根据需要将其设置为 false。如果设置为
                        false，内容过滤功能将被禁用，所有结果将由模型直接返回。
                  required:
                    - prompt
                  x-apidog-orders:
                    - prompt
                    - aspect_ratio
                    - resolution
                    - duration
                    - camera_fixed
                    - seed
                    - enable_safety_checker
                    - nsfw_checker
                  x-apidog-ignore-properties: []
              x-apidog-orders:
                - model
                - callBackUrl
                - input
              x-apidog-ignore-properties: []
            example:
              model: bytedance/v1-pro-text-to-video
              callBackUrl: https://your-domain.com/api/callback
              input:
                prompt: |-
                  日落时分，一个卷头发、背着书包的男孩骑着自行车行驶在洒满金光的乡间小路上。
                  【切镜】他放慢车速，望向一片高高的草地。
                  【广角镜头】他的剪影停驻在橘色的薄雾中。
                aspect_ratio: '16:9'
                resolution: 720p
                duration: '5'
                camera_fixed: false
                seed: -1
                enable_safety_checker: true
                nsfw_checker: true
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
                  taskId: task_bytedance_1765186736545
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
      x-apidog-folder: docs/zh-CN/Market/Video Models/Bytedance
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-28506673-run
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
