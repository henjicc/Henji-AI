# 生成 Aleph 视频

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /api/v1/aleph/generate:
    post:
      summary: 生成 Aleph 视频
      deprecated: false
      description: >-
        ## 概述


        使用 Runway 先进的 Aleph AI
        模型将现有视频转换为增强的动态内容。此端点通过文本引导转换实现精确的视频到视频生成，非常适合从现有视频创建增强的视觉内容。


        ::: note[]

        Runway Aleph API 需要文本提示词和参考视频 URL 来生成转换后的视频。AI 将根据您的文本描述对提供的视频进行修改和增强。

        :::


        ## 下一步


        成功创建视频生成任务后，您有几个选择：


        <Steps>

        <Step title="监控任务状态">
          使用返回的 `taskId` 检查生成进度：
          
          ```bash
          curl -X GET "https://api.kie.ai/api/v1/aleph/record-detail?taskId=YOUR_TASK_ID" \
            -H "Authorization: Bearer YOUR_API_KEY"
          ```
          
          <Card title="获取任务详情" icon="magnifying-glass" href="/cn/runway-api/get-aleph-video-details">
            检查任务状态和检索结果的完整指南
          </Card>
        </Step>


        <Step title="处理回调（推荐）">
          如果您提供了 `callBackUrl`，请实现 webhook 端点来接收完成通知：
          
          <Card title="回调实现" icon="webhook" href="/cn/runway-api/generate-aleph-video-callbacks">
            学习如何高效处理回调通知
          </Card>
        </Step>


        <Step title="下载和处理结果">
          生成完成后，下载您的视频和缩略图：
          
          ```javascript
          // 示例：完成后下载视频
          const downloadVideo = async (videoUrl, filename) => {
            const response = await fetch(videoUrl);
            const buffer = await response.arrayBuffer();
            // 保存到文件或根据需要处理
          };
          ```
        </Step>

        </Steps>


        ## 最佳实践


        <AccordionGroup>

        <Accordion title="优化图像选择">

        **选择高质量的源图像：**

        - 使用主体清晰、光线良好的图像

        - 确保最小分辨率为 512x512 像素

        - 避免高度压缩或低质量的图像

        - 选择有明确焦点的图像以获得更好的动画效果


        **构图考虑：**

        - 具有中心主体的图像最适合动画

        - 考虑镜头运动如何影响构图

        - 避免背景过于复杂的图像

        </Accordion>


        <Accordion title="制作有效的提示词">

        **专注于运动和动作：**

        - 描述图像中的元素应如何移动或变化

        - 包含镜头运动描述（缩放、平移、旋转）

        - 指定运动的节奏和风格（缓慢、戏剧性、平滑）


        **好提示词的示例：**

        - "雄鹰展开翅膀，以雄伟的慢动作飞行向上翱翔"

        - "镜头缓慢后拉，展现主体后面的广阔山景"

        - "微风轻抚，树叶轻摇，阳光动态地透过树叶洒下"

        </Accordion>


        <Accordion title="错误处理和重试逻辑">

        **实现健壮的错误处理：**

        ```javascript

        const generateWithRetry = async (params, maxRetries = 3) => {
          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
              return await generateAlephVideo(params);
            } catch (error) {
              if (attempt === maxRetries) throw error;
              
              // 指数退避
              const delay = Math.pow(2, attempt) * 1000;
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          }
        };

        ```


        **处理不同的错误类型：**

        - 网络错误：使用指数退避重试

        - 身份验证错误：检查并刷新 API 密钥

        - 验证错误：在重试前修复参数

        - 速率限制：实现适当的退避策略

        </Accordion>


        <Accordion title="生产部署技巧">

        **使用回调提高效率：**

        - 实现 webhook 端点而不是轮询

        - 确保您的回调 URL 公开可访问且安全

        - 通过适当的日志记录处理回调失败


        **监控 API 使用：**

        - 跟踪您的 API 使用和积分消耗

        - 在您的端实现速率限制以避免达到 API 限制

        - 记录所有请求和响应以便调试


        **存储考虑：**

        - 根据用户群选择适当的 `uploadCn` 设置

        - 为 14 天视频保留期制定计划

        - 为重要内容实现自动下载系统

        </Accordion>

        </AccordionGroup>
      operationId: generate-aleph-video
      tags:
        - docs/zh-CN/Market/Video Models/Runway API/Aleph
      parameters: []
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required:
                - prompt
                - videoUrl
              properties:
                prompt:
                  type: string
                  description: 指导 AI 视频转换的描述性文本。请具体描述主题、动作、风格和设置。描述如何根据提示词对参考视频内容进行转换或修改。
                  examples:
                    - 一只雄鹰在夕阳下的山间云雾中翱翔，配以电影级镜头运动
                videoUrl:
                  type: string
                  description: 用作视频生成基础的参考视频 URL。AI 将根据提示词对该视频进行转换和增强。
                  examples:
                    - https://example.com/input-video.mp4
                callBackUrl:
                  type: string
                  description: >-
                    接收 AI 视频生成任务完成更新的 URL。


                    - 当视频生成完成时，系统将向此 URL 发送 POST 请求，包含任务状态和结果

                    - 回调包含生成的视频 URL、封面图像和任务信息

                    - 您的回调端点应接受包含视频结果的 JSON 负载的 POST 请求

                    - 有关详细的回调格式和实施指南，请参阅 [Aleph
                    视频生成回调](https://docs.kie.ai/cn/runway-api/generate-aleph-video-callbacks)

                    - 或者，使用获取 Aleph 视频详情端点轮询任务状态

                    - 为确保回调安全性，请参阅 [Webhook
                    校验指南](/cn/common-api/webhook-verification) 了解签名验证实现方法
                  examples:
                    - https://api.example.com/callback
                waterMark:
                  type: string
                  description: 可选的水印文本内容。空字符串表示无水印，非空字符串将在视频中显示指定文本作为水印。
                  examples:
                    - kie.ai
                uploadCn:
                  type: boolean
                  description: >-
                    上传方式选择。默认值为 false（S3/R2），设置为 true 使用阿里云 OSS 上传，设置为 false
                    使用海外 R2 服务器上传。
                  default: false
                  examples:
                    - false
                aspectRatio:
                  type: string
                  description: 视频纵横比。
                  enum:
                    - '16:9'
                    - '9:16'
                    - '4:3'
                    - '3:4'
                    - '1:1'
                    - '21:9'
                  examples:
                    - '16:9'
                seed:
                  type: integer
                  description: 随机种子。用于结果可复现。
                  examples:
                    - 123456
                referenceImage:
                  type: string
                  format: uri
                  description: 参考图像 URL，用于影响输出的风格或内容。
                  examples:
                    - https://example.com/reference.jpg
              x-apidog-orders:
                - prompt
                - videoUrl
                - callBackUrl
                - waterMark
                - uploadCn
                - aspectRatio
                - seed
                - referenceImage
              x-apidog-ignore-properties: []
            example:
              prompt: 一只雄鹰在夕阳下的山间云雾中翱翔，配以电影级镜头运动
              videoUrl: https://example.com/input-video.mp4
              callBackUrl: https://api.example.com/callback
              waterMark: kie.ai
              uploadCn: false
      responses:
        '200':
          description: 请求成功
          content:
            application/json:
              schema:
                allOf:
                  - type: object
                    properties:
                      code:
                        type: integer
                        enum:
                          - 200
                          - 401
                          - 404
                          - 422
                          - 451
                          - 455
                          - 500
                        description: |-
                          响应状态码

                          - **200**: 成功 - 请求已成功处理
                          - **401**: 未授权 - 身份验证凭据缺失或无效
                          - **404**: 未找到 - 请求的资源或端点不存在
                          - **422**: 验证错误 - 请求参数验证失败.请求参数不正确，请检查参数。
                          - **451**: 未授权 - 获取图像失败。请验证您或您的服务提供商设置的任何访问限制。
                          - **455**: 服务不可用 - 系统当前正在维护中
                          - **500**: 服务器错误 - 处理请求时发生意外错误
                      msg:
                        type: string
                        description: 当 code != 200 时的错误消息
                        examples:
                          - success
                    x-apidog-orders:
                      - code
                      - msg
                    x-apidog-ignore-properties: []
                  - type: object
                    properties:
                      data:
                        type: object
                        properties:
                          taskId:
                            type: string
                            description: 生成任务的唯一标识符，可与 `获取 Aleph 视频详情` 一起使用来查询任务状态
                            examples:
                              - ee603959-debb-48d1-98c4-a6d1c717eba6
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
                  taskId: ee603959-debb-48d1-98c4-a6d1c717eba6
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
      callbacks:
        onVideoGenerated:
          '{$request.body#/callBackUrl}':
            post:
              summary: Aleph 视频生成完成回调
              description: 当 Aleph 视频生成完成时，系统将向提供的回调 URL 发送 POST 请求以通知结果
              requestBody:
                required: true
                content:
                  application/json:
                    schema:
                      type: object
                      required:
                        - code
                        - data
                        - msg
                      properties:
                        code:
                          type: integer
                          description: 状态码，200 表示成功
                          example: 200
                        msg:
                          type: string
                          description: 状态消息
                          example: All generated successfully.
                        data:
                          type: object
                          required:
                            - image_url
                            - task_id
                            - video_id
                            - video_url
                          properties:
                            image_url:
                              type: string
                              description: 生成视频的封面图像 URL
                              example: https://file.com/m/xxxxxxxx.png
                            task_id:
                              type: string
                              description: 任务 ID
                              example: ee603959-debb-48d1-98c4-a6d1c717eba6
                            video_id:
                              type: string
                              description: 视频 ID
                              example: 485da89c-7fca-4340-8c04-101025b2ae71
                            video_url:
                              type: string
                              description: 可访问的视频 URL，有效期 14 天
                              example: https://file.com/k/xxxxxxx.mp4
              responses:
                '200':
                  description: 回调接收成功
                  content:
                    application/json:
                      schema:
                        allOf:
                          - type: object
                            properties:
                              code:
                                type: integer
                                enum:
                                  - 200
                                  - 400
                                  - 500
                                description: >-
                                  响应状态码


                                  - **200**: 成功 - 请求已成功处理

                                  - **400**: 检测到不当内容。请替换图像或视频。

                                  图像格式不正确。

                                  请稍后重试。您可以升级到标准会员资格以立即开始生成。

                                  达到并发生成限制。

                                  不支持的宽度或高度。请调整尺寸后重试。

                                  由于网络原因上传失败，请重新输入。

                                  Your prompt was caught by our AI moderator.
                                  Please adjust it and try again!

                                  您的提示词/负面提示词不能超过 2048 个字符。请检查输入是否过长。

                                  您的视频创建提示词包含 NSFW
                                  内容，这在我们的政策下是不允许的。请修改您的提示词并重新生成。

                                  - **500**: 服务器错误 - 处理请求时发生意外错误
                              msg:
                                type: string
                                description: 当 code != 200 时的错误消息
                                example: success
                      example:
                        code: 200
                        msg: success
      x-apidog-folder: docs/zh-CN/Market/Video Models/Runway API/Aleph
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-28506747-run
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
