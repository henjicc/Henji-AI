# ElevenLabs对话文生语音V3

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
      summary: ElevenLabs对话文生语音V3
      deprecated: false
      description: >
        ## 查询任务状态


        提交任务后，使用统一的查询端点检查进度并获取结果：


        <Card title="获取任务详情" icon="magnifying-glass"
        href="/cn/market/common/get-task-detail">
          了解如何查询任务状态并获取生成结果
        </Card>


        ::: tip[]

        对于生产环境，我们建议使用 `callBackUrl` 参数接收自动通知，而不是轮询状态端点。

        :::


        ## 相关资源


        <CardGroup cols={3}>
          <Card title="市场概览" icon="store" href="/cn/market/quickstart">
            探索所有可用模型
          </Card>
          <Card title="文件上传API" icon="upload" href="/cn/file-upload-api/quickstart">
            了解如何上传和管理文件
          </Card>
          <Card title="通用API" icon="gear" href="/cn/common-api/get-account-credits">
            查看积分和账户使用情况
          </Card>
        </CardGroup>
      operationId: elevenlabs-text-to-dialogue-v3
      tags:
        - docs/zh-CN/Market/Music Models/ElevenLabs
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
                    - elevenlabs/text-to-dialogue-v3
                  default: elevenlabs/text-to-dialogue-v3
                  description: |-
                    用于生成的模型名称。必填字段。

                    - 此端点必须使用 `elevenlabs/text-to-dialogue-v3`
                  examples:
                    - elevenlabs/text-to-dialogue-v3
                callBackUrl:
                  type: string
                  format: uri
                  description: >-
                    接收生成任务完成更新的 URL。可选但建议在生产环境中使用。


                    - 当生成完成时，系统将向此 URL POST 任务状态和结果

                    - 回调包含生成的 URL 和任务信息

                    - 您的回调端点应接受包含结果的 JSON 负载的 POST 请求

                    - 或者，使用获取任务详情端点轮询任务状态

                    - 为确保回调安全性，请参阅 [Webhook
                    校验指南](/cn/common-api/webhook-verification) 了解签名验证实现方法
                  examples:
                    - https://your-domain.com/api/callback
                input:
                  type: object
                  description: 生成任务的输入参数
                  required:
                    - dialogue
                  properties:
                    dialogue:
                      type: array
                      description: 对话项数组。每个项包含文本和语音角色。所有文本字段的总字符数不得超过 5000 个字符。
                      items:
                        type: object
                        required:
                          - text
                          - voice
                        properties:
                          text:
                            type: string
                            description: 对话文本内容。对话数组中所有文本字段的总字符数不得超过 5000 个字符。
                            examples:
                              - I have a pen, I have an apple, ah, Apple pen~
                          voice:
                            type: string
                            description: >-
                              用于此对话行的语音。可为预设名称（如 Adam、Brian）或 voice_id。可在浏览器中打开
                              https://static.aiquickdraw.com/elevenlabs/voice/<voice_id>.mp3
                              试听（将 <voice_id> 替换为实际语音
                              ID）。例如：https://static.aiquickdraw.com/elevenlabs/voice/EkK5I93UQWFDigLMpZcX.mp3


                              可用语音列表：


                              EkK5I93UQWFDigLMpZcX - James - 沙哑、引人入胜、大胆

                              Z3R5wn05IrDiVCyEkUrK - Arabella - 神秘、富有情感

                              NNl6r8mD7vthiJatiJt1 - Bradford - 富有表现力、口齿清晰

                              YOq2y2Up4RgXP2HyXjE5 - Xavier - 霸气、金属感播音员

                              B8gJV1IhpuegLxdpXFOE - Kuon - 开朗、清晰、稳定

                              2zRM7PkgwBPiau2jvVXc - Monika Sogam - 低沉、自然

                              1SM7GgM6IMuvQlz2BwM3 - Mark - 随意、放松、轻快

                              5l5f8iK3YPeGga21rQIX - Adeline - 女性化、对话式

                              scOwDtmlUjD3prqpp97I - Sam - 客服代理

                              NOpBlnGInO9m6vDvFkFC - Spuds Oxley - 睿智、平易近人

                              BZgkqPqms7Kj9ulSkVzn - Eve - 真实、充满活力、快乐

                              wo6udizrrtpIxWGp2qJk - Northern Terry

                              gU0LNdkMOQCOrPrwtbee - British Football Announcer
                              - 英国足球解说员

                              DGzg6RaUqxGRTHSBjfgF - Brock - 威严、大声的军士

                              x70vRnQBMBu4FAYhjJbO - Nathan - 虚拟电台主持人

                              Sm1seazb4gs7RSlUVw7c - Anika - 活泼、友好、引人入胜

                              P1bg08DkjqiVEzOn76yG - Viraj - 丰富、柔和

                              qDuRKMlYmrm8trt5QyBn - Taksh - 平静、严肃、流畅

                              qXpMhyvQqiRxWQs4qSSB - Horatius - 充满活力的角色配音

                              TX3LPaxmHKxFdv7VOQHJ - Liam - 充满活力、社交媒体创作者

                              N2lVS1w4EtoT3dr4eOWO - Callum - 沙哑的骗子

                              FGY2WhTYpPnrIDTdsKH5 - Laura - 热情、古怪的态度

                              kPzsL2i3teMYv0FxEYQ6 - Brittney - 社交媒体语音 -
                              有趣、年轻、信息丰富

                              UgBBYS2sOqTuMpoF3BR0 - Mark - 自然对话

                              hpp4J3VqNfWAUOO0d1Us - Bella - 专业、明亮、温暖

                              nPczCjzI2devNBz1zQrb - Brian - 低沉、共鸣、令人安慰

                              uYXf8XasLslADfZ2MB4u - Hope - 活泼、八卦、少女感

                              gs0tAILXbY5DNrJrsM6F - Jeff - 优雅、共鸣、强劲

                              DTKMou8ccj1ZaWGBiotd - Jamahal - 年轻、充满活力、自然

                              vBKc2FfBKJfcZNyEt1n6 - Finn - 年轻、热切、充满活力

                              DYkrAHD8iwork3YSUBbs - Tom - 对话与书籍

                              56AoDkrOh6qfVPDXZ7Pt - Cassidy - 清脆、直接、清晰

                              eR40ATw9ArzDf9h3v7t7 - Addison 2.0 - 澳大利亚有声书与播客

                              g6xIsTj2HwM6VR4iXFCw - Jessica Anne Bogart - 健谈、友好

                              lcMyyd2HUfFzxdCaC4Ta - Lucy - 清新、随意

                              6aDn1KB0hjpdcocrUkmq - Tiffany - 自然、热情

                              Sq93GQT4X1lKDXsQcixO - Felix - 温暖、积极、现代RP

                              flHkNRp1BlvT73UL6gyz - Jessica Anne Bogart - 雄辩的反派

                              9yzdeviXkFddZ4Oz8Mok - Lutz - 咯咯笑、欢快

                              pPdl9cQBQq4p6mRkZy2Z - Emma - 可爱、积极向上

                              zYcjlYFOd3taleS0gkk3 - Edward - 大声、自信、自负

                              nzeAacJi50IvxcyDnMXa - Marshal - 友好、幽默的教授

                              ruirxsoakN0GWmGNIo04 - John Morgan - 粗犷、坚韧的牛仔

                              TC0Zp7WVFzhA8zpTlRqV - Aria - 性感反派

                              ljo9gAlSqKOvF6D8sOsX - Viking Bjorn - 史诗中世纪掠夺者

                              PPzYpIqttlTYA83688JI - Pirate Marshal - 海盗元帅

                              8JVbfL6oEdmuxKn5DK2C - Johnny Kid - 严肃、平静的旁白

                              iCrDUkL56s3C8sCRl7wb - Hope - 诗意、浪漫、迷人

                              wJqPPQ618aTW29mptyoc - Ana Rita - 流畅、富有表现力、明亮

                              EiNlNiXeDU1pqqOPrYMO - John Doe - 低沉

                              4YYIPFl9wE5c4L2eu2Gb - Burt Reynolds™ - 低沉、流畅、清晰

                              6F5Zhi321D3Oq7v1oNT4 - Hank - 低沉、引人入胜的旁白

                              YXpFCvM1S3JbWEJhoskW - Wyatt - 睿智乡村牛仔

                              LG95yZDEHg6fCZdQjLqj - Phil - 爆发力、热情播音员

                              CeNX9CMwmxDxUF5Q2Inm - Johnny Dynamite - 复古电台DJ

                              aD6riP1btT197c6dACmy - Rachel M - 专业英国电台主持人

                              mtrellq69YZsNwzUSyXh - Rex Thunder - 低沉强硬

                              dHd5gvgSOzSfduK4CvEg - Ed - 深夜播音员

                              eVItLK1UvXctxuaRV2Oq - Jean - 迷人、俏皮的蛇蝎美人

                              esy0r39YPLQjOczyOib8 - Britney - 冷静、算计的反派

                              Tsns2HvNFKfGiNjllgqo - Sven - 情感丰富、友善

                              1U02n4nD6AdIZ9CjF053 - Viraj - 流畅、温柔

                              AeRdCCKzvd23BpJoofzx - Nathaniel - 引人入胜、英式、平静

                              LruHrtVF6PSyGItzMNHS - Benjamin - 低沉、温暖、平静

                              1wGbFxmAM3Fgw63G1zZJ - Allison - 平静、舒缓、冥想

                              hqfrgApggtO1785R4Fsn - Theodore HQ - 宁静、沉稳

                              MJ0RnG71ty4LH3dvNfSd - Leon - 舒缓、沉稳
                            enum:
                              - EkK5I93UQWFDigLMpZcX
                              - Z3R5wn05IrDiVCyEkUrK
                              - NNl6r8mD7vthiJatiJt1
                              - YOq2y2Up4RgXP2HyXjE5
                              - B8gJV1IhpuegLxdpXFOE
                              - 2zRM7PkgwBPiau2jvVXc
                              - 1SM7GgM6IMuvQlz2BwM3
                              - 5l5f8iK3YPeGga21rQIX
                              - scOwDtmlUjD3prqpp97I
                              - NOpBlnGInO9m6vDvFkFC
                              - BZgkqPqms7Kj9ulSkVzn
                              - wo6udizrrtpIxWGp2qJk
                              - gU0LNdkMOQCOrPrwtbee
                              - DGzg6RaUqxGRTHSBjfgF
                              - x70vRnQBMBu4FAYhjJbO
                              - Sm1seazb4gs7RSlUVw7c
                              - P1bg08DkjqiVEzOn76yG
                              - qDuRKMlYmrm8trt5QyBn
                              - qXpMhyvQqiRxWQs4qSSB
                              - TX3LPaxmHKxFdv7VOQHJ
                              - N2lVS1w4EtoT3dr4eOWO
                              - FGY2WhTYpPnrIDTdsKH5
                              - kPzsL2i3teMYv0FxEYQ6
                              - UgBBYS2sOqTuMpoF3BR0
                              - hpp4J3VqNfWAUOO0d1Us
                              - nPczCjzI2devNBz1zQrb
                              - uYXf8XasLslADfZ2MB4u
                              - gs0tAILXbY5DNrJrsM6F
                              - DTKMou8ccj1ZaWGBiotd
                              - vBKc2FfBKJfcZNyEt1n6
                              - DYkrAHD8iwork3YSUBbs
                              - 56AoDkrOh6qfVPDXZ7Pt
                              - eR40ATw9ArzDf9h3v7t7
                              - g6xIsTj2HwM6VR4iXFCw
                              - lcMyyd2HUfFzxdCaC4Ta
                              - 6aDn1KB0hjpdcocrUkmq
                              - Sq93GQT4X1lKDXsQcixO
                              - flHkNRp1BlvT73UL6gyz
                              - 9yzdeviXkFddZ4Oz8Mok
                              - pPdl9cQBQq4p6mRkZy2Z
                              - zYcjlYFOd3taleS0gkk3
                              - nzeAacJi50IvxcyDnMXa
                              - ruirxsoakN0GWmGNIo04
                              - TC0Zp7WVFzhA8zpTlRqV
                              - ljo9gAlSqKOvF6D8sOsX
                              - PPzYpIqttlTYA83688JI
                              - 8JVbfL6oEdmuxKn5DK2C
                              - iCrDUkL56s3C8sCRl7wb
                              - wJqPPQ618aTW29mptyoc
                              - EiNlNiXeDU1pqqOPrYMO
                              - 4YYIPFl9wE5c4L2eu2Gb
                              - 6F5Zhi321D3Oq7v1oNT4
                              - YXpFCvM1S3JbWEJhoskW
                              - LG95yZDEHg6fCZdQjLqj
                              - CeNX9CMwmxDxUF5Q2Inm
                              - aD6riP1btT197c6dACmy
                              - mtrellq69YZsNwzUSyXh
                              - dHd5gvgSOzSfduK4CvEg
                              - eVItLK1UvXctxuaRV2Oq
                              - esy0r39YPLQjOczyOib8
                              - Tsns2HvNFKfGiNjllgqo
                              - 1U02n4nD6AdIZ9CjF053
                              - AeRdCCKzvd23BpJoofzx
                              - LruHrtVF6PSyGItzMNHS
                              - 1wGbFxmAM3Fgw63G1zZJ
                              - hqfrgApggtO1785R4Fsn
                              - MJ0RnG71ty4LH3dvNfSd
                            x-apidog-enum:
                              - value: EkK5I93UQWFDigLMpZcX
                                name: ''
                                description: ''
                              - value: Z3R5wn05IrDiVCyEkUrK
                                name: ''
                                description: ''
                              - value: NNl6r8mD7vthiJatiJt1
                                name: ''
                                description: ''
                              - value: YOq2y2Up4RgXP2HyXjE5
                                name: ''
                                description: ''
                              - value: B8gJV1IhpuegLxdpXFOE
                                name: ''
                                description: ''
                              - value: 2zRM7PkgwBPiau2jvVXc
                                name: ''
                                description: ''
                              - value: 1SM7GgM6IMuvQlz2BwM3
                                name: ''
                                description: ''
                              - value: 5l5f8iK3YPeGga21rQIX
                                name: ''
                                description: ''
                              - value: scOwDtmlUjD3prqpp97I
                                name: ''
                                description: ''
                              - value: NOpBlnGInO9m6vDvFkFC
                                name: ''
                                description: ''
                              - value: BZgkqPqms7Kj9ulSkVzn
                                name: ''
                                description: ''
                              - value: wo6udizrrtpIxWGp2qJk
                                name: ''
                                description: ''
                              - value: gU0LNdkMOQCOrPrwtbee
                                name: ''
                                description: ''
                              - value: DGzg6RaUqxGRTHSBjfgF
                                name: ''
                                description: ''
                              - value: x70vRnQBMBu4FAYhjJbO
                                name: ''
                                description: ''
                              - value: Sm1seazb4gs7RSlUVw7c
                                name: ''
                                description: ''
                              - value: P1bg08DkjqiVEzOn76yG
                                name: ''
                                description: ''
                              - value: qDuRKMlYmrm8trt5QyBn
                                name: ''
                                description: ''
                              - value: qXpMhyvQqiRxWQs4qSSB
                                name: ''
                                description: ''
                              - value: TX3LPaxmHKxFdv7VOQHJ
                                name: ''
                                description: ''
                              - value: N2lVS1w4EtoT3dr4eOWO
                                name: ''
                                description: ''
                              - value: FGY2WhTYpPnrIDTdsKH5
                                name: ''
                                description: ''
                              - value: kPzsL2i3teMYv0FxEYQ6
                                name: ''
                                description: ''
                              - value: UgBBYS2sOqTuMpoF3BR0
                                name: ''
                                description: ''
                              - value: hpp4J3VqNfWAUOO0d1Us
                                name: ''
                                description: ''
                              - value: nPczCjzI2devNBz1zQrb
                                name: ''
                                description: ''
                              - value: uYXf8XasLslADfZ2MB4u
                                name: ''
                                description: ''
                              - value: gs0tAILXbY5DNrJrsM6F
                                name: ''
                                description: ''
                              - value: DTKMou8ccj1ZaWGBiotd
                                name: ''
                                description: ''
                              - value: vBKc2FfBKJfcZNyEt1n6
                                name: ''
                                description: ''
                              - value: DYkrAHD8iwork3YSUBbs
                                name: ''
                                description: ''
                              - value: 56AoDkrOh6qfVPDXZ7Pt
                                name: ''
                                description: ''
                              - value: eR40ATw9ArzDf9h3v7t7
                                name: ''
                                description: ''
                              - value: g6xIsTj2HwM6VR4iXFCw
                                name: ''
                                description: ''
                              - value: lcMyyd2HUfFzxdCaC4Ta
                                name: ''
                                description: ''
                              - value: 6aDn1KB0hjpdcocrUkmq
                                name: ''
                                description: ''
                              - value: Sq93GQT4X1lKDXsQcixO
                                name: ''
                                description: ''
                              - value: flHkNRp1BlvT73UL6gyz
                                name: ''
                                description: ''
                              - value: 9yzdeviXkFddZ4Oz8Mok
                                name: ''
                                description: ''
                              - value: pPdl9cQBQq4p6mRkZy2Z
                                name: ''
                                description: ''
                              - value: zYcjlYFOd3taleS0gkk3
                                name: ''
                                description: ''
                              - value: nzeAacJi50IvxcyDnMXa
                                name: ''
                                description: ''
                              - value: ruirxsoakN0GWmGNIo04
                                name: ''
                                description: ''
                              - value: TC0Zp7WVFzhA8zpTlRqV
                                name: ''
                                description: ''
                              - value: ljo9gAlSqKOvF6D8sOsX
                                name: ''
                                description: ''
                              - value: PPzYpIqttlTYA83688JI
                                name: ''
                                description: ''
                              - value: 8JVbfL6oEdmuxKn5DK2C
                                name: ''
                                description: ''
                              - value: iCrDUkL56s3C8sCRl7wb
                                name: ''
                                description: ''
                              - value: wJqPPQ618aTW29mptyoc
                                name: ''
                                description: ''
                              - value: EiNlNiXeDU1pqqOPrYMO
                                name: ''
                                description: ''
                              - value: 4YYIPFl9wE5c4L2eu2Gb
                                name: ''
                                description: ''
                              - value: 6F5Zhi321D3Oq7v1oNT4
                                name: ''
                                description: ''
                              - value: YXpFCvM1S3JbWEJhoskW
                                name: ''
                                description: ''
                              - value: LG95yZDEHg6fCZdQjLqj
                                name: ''
                                description: ''
                              - value: CeNX9CMwmxDxUF5Q2Inm
                                name: ''
                                description: ''
                              - value: aD6riP1btT197c6dACmy
                                name: ''
                                description: ''
                              - value: mtrellq69YZsNwzUSyXh
                                name: ''
                                description: ''
                              - value: dHd5gvgSOzSfduK4CvEg
                                name: ''
                                description: ''
                              - value: eVItLK1UvXctxuaRV2Oq
                                name: ''
                                description: ''
                              - value: esy0r39YPLQjOczyOib8
                                name: ''
                                description: ''
                              - value: Tsns2HvNFKfGiNjllgqo
                                name: ''
                                description: ''
                              - value: 1U02n4nD6AdIZ9CjF053
                                name: ''
                                description: ''
                              - value: AeRdCCKzvd23BpJoofzx
                                name: ''
                                description: ''
                              - value: LruHrtVF6PSyGItzMNHS
                                name: ''
                                description: ''
                              - value: 1wGbFxmAM3Fgw63G1zZJ
                                name: ''
                                description: ''
                              - value: hqfrgApggtO1785R4Fsn
                                name: ''
                                description: ''
                              - value: MJ0RnG71ty4LH3dvNfSd
                                name: ''
                                description: ''
                            default: EkK5I93UQWFDigLMpZcX
                            examples:
                              - EkK5I93UQWFDigLMpZcX
                        x-apidog-orders:
                          - text
                          - voice
                        x-apidog-ignore-properties: []
                      examples:
                        - - text: I have a pen, I have an apple, ah, Apple pen~
                            voice: Adam
                          - text: a happy dog
                            voice: Brian
                          - text: a happy cat
                            voice: Roger
                    stability:
                      type: number
                      description: 声音稳定性调节参数。必须是以下值之一：0.0、0.5 或 1.0
                      enum:
                        - 0
                        - 0.5
                        - 1
                      default: 0.5
                      examples:
                        - 0.5
                    language_code:
                      type: string
                      description: 语言代码。默认为空字符串或不传，代表自动检测语言。
                      enum:
                        - af
                        - ar
                        - hy
                        - as
                        - az
                        - be
                        - bn
                        - bs
                        - bg
                        - ca
                        - ceb
                        - ny
                        - hr
                        - cs
                        - da
                        - nl
                        - en
                        - et
                        - fil
                        - fi
                        - fr
                        - gl
                        - ka
                        - de
                        - el
                        - gu
                        - ha
                        - he
                        - hi
                        - hu
                        - is
                        - id
                        - ga
                        - it
                        - ja
                        - jv
                        - kn
                        - kk
                        - ky
                        - ko
                        - lv
                        - ln
                        - lt
                        - lb
                        - mk
                        - ms
                        - ml
                        - zh
                        - mr
                        - ne
                        - 'no'
                        - ps
                        - fa
                        - pl
                        - pt
                        - pa
                        - ro
                        - ru
                        - sr
                        - sd
                        - sk
                        - sl
                        - so
                        - es
                        - sw
                        - sv
                        - ta
                        - te
                        - th
                        - tr
                        - uk
                        - ur
                        - vi
                        - cy
                  x-apidog-orders:
                    - dialogue
                    - stability
                    - language_code
                  x-apidog-ignore-properties: []
              x-apidog-orders:
                - model
                - callBackUrl
                - input
              x-apidog-ignore-properties: []
            example:
              model: elevenlabs/text-to-dialogue-v3
              callBackUrl: https://your-domain.com/api/callback
              input:
                dialogue:
                  - text: I have a pen, I have an apple, ah, Apple pen~
                    voice: EkK5I93UQWFDigLMpZcX
                  - text: a happy dog
                    voice: Z3R5wn05IrDiVCyEkUrK
                  - text: a happy cat
                    voice: NNl6r8mD7vthiJatiJt1
                stability: 0.5
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
                  recordId: elevenlabs_12345678
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
      x-apidog-folder: docs/zh-CN/Market/Music Models/ElevenLabs
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-28506699-run
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
