# Kling-3.0 motion-control

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
      summary: Kling-3.0 motion-control
      deprecated: false
      description: >
        ## 文件上传要求


        在使用运动控制 API 之前，您需要上传您的图像和视频文件：


        <Steps>

        <Step title="上传参考图像">
          使用文件上传 API 上传显示对象的参考图像。

          <Card title="文件上传 API" icon="upload" href="/cn/file-upload-api/quickstart">
            了解如何上传图像并获取文件 URL
          </Card>

          **要求：**
          - **文件类型**：JPEG、PNG 或 JPG 格式
          - **最大文件大小**：每个文件 10MB，尺寸需大于 340px，宽高比为 2:5 至 5:2。
          - **内容**：清楚显示对象的头部、肩膀和躯干的图像
        </Step>


        <Step title="上传运动视频">
          上传定义您要应用运动模式的视频。

          **要求：**
          - **文件类型**：MP4 或 QuickTime 格式
          - **持续时间**：每个视频 3-30 秒
          - **最大文件大小**：每个文件 100MB，尺寸需大于 340px，宽高比为 2:5 至 5:2。
          - **内容**：清楚显示对象的头部、肩膀和躯干的视频
        </Step>


        <Step title="获取文件 URL">
          上传后，您将收到可在 `input_urls` 和 `video_urls` 参数中使用的文件 URL。
        </Step>

        </Steps>


        ::: warning[]

        - 支持的图像格式：JPEG、PNG、JPG（最大：10MB），尺寸需大于 340px，宽高比为 2:5 至 5:2。

        - 支持的视频格式：MP4、QuickTime（最大：100MB，3-30 秒），尺寸需大于 340px，宽高比为 2:5 至 5:2。

        - 视频必须清楚显示对象的头部、肩膀和躯干

        - 每个请求最多一个图像和一个视频

        :::


        ## 查询任务状态


        提交任务后，使用统一的查询端点来检查进度并获取结果：


        <Card title="获取任务详情" icon="magnifying-glass"
        href="/cn/market/common/get-task-detail">
          了解如何查询任务状态并获取生成结果
        </Card>


        ::: tip[]

        对于生产环境，我们建议使用 `callBackUrl` 参数来接收生成完成时的自动通知，而不是轮询状态端点。

        :::


        ## 相关资源


        <CardGroup cols={2}>
          <Card title="市场概览" icon="store" href="/cn/market/quickstart">
            探索所有可用的模型
          </Card>
          <Card title="通用 API" icon="gear" href="/cn/common-api/get-account-credits">
            检查积分和账户使用情况
          </Card>
        </CardGroup>
      operationId: kling-3-0-motion-control
      tags:
        - docs/zh-CN/Market/Video Models/Kling
      parameters: []
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                model:
                  type: string
                  description: |-
                    用于生成任务的模型名称。必填字段。

                    - 此端点必须为 `kling-3.0/motion-control`
                  examples:
                    - kling-3.0/motion-control
                  enum:
                    - kling-3.0/motion-control
                  x-apidog-enum:
                    - value: kling-3.0/motion-control
                      name: ''
                      description: ''
                  default: kling-3.0/motion-control
                callBackUrl:
                  description: 回调地址，当生成完成后模型会通知这个 URL
                  type: string
                input:
                  type: object
                  properties:
                    prompt:
                      description: (可选) 文本提示词，用于引导生成动画内容，可为空或 0-2500 字符
                      type: string
                    input_urls:
                      type: array
                      items:
                        type: string
                      description: (必填)包含一个图片url
                    video_urls:
                      type: array
                      items:
                        type: string
                      description: (必填)包含一个视频url
                    mode:
                      description: '(可选) 视频质量模式。std: 标准模式 (720p). pro: 专业模式 (1080p)'
                      type: string
                    character_orientation:
                      description: '(可选) 角色朝向参考来源。video: 参考视频 (推荐)；image: 参考图片。默认值: video'
                      type: string
                    background_source:
                      description: >-
                        (可选) 背景来源。input_video: 使用视频背景；input_image: 使用图片背景。默认值:
                        input_video
                      type: string
                  required:
                    - input_urls
                    - video_urls
                  x-apidog-orders:
                    - prompt
                    - input_urls
                    - video_urls
                    - mode
                    - character_orientation
                    - background_source
                  x-apidog-ignore-properties: []
              required:
                - model
                - callBackUrl
                - input
              x-apidog-orders:
                - model
                - callBackUrl
                - input
              x-apidog-ignore-properties: []
            example:
              model: kling-3.0/motion-control
              callBackUrl: https://your-domain.com/api/callback
              input:
                prompt: The cartoon character is dancing.
                input_urls:
                  - >-
                    https://static.aiquickdraw.com/tools/example/1767694885407_pObJoMcy.png
                video_urls:
                  - >-
                    https://static.aiquickdraw.com/tools/example/1767525918769_QyvTNib2.mp4
                mode: 720p
                character_orientation: image
                background_source: input_video
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
                  taskId: task_kling-3.0_1096798773938
          headers: {}
          x-apidog-name: 成功
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
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-30063040-run
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
