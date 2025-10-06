const axios = require('axios')
const claudeConsoleAccountService = require('./claudeConsoleAccountService')
const logger = require('../utils/logger')
const config = require('../../config/config')

class ClaudeConsoleRelayService {
  constructor() {
    this.defaultUserAgent = 'claude-cli/1.0.69 (external, cli)'
    this.claudeCodeSystemPrompt = "You are Claude Code, Anthropic's official CLI for Claude."
  }

  // 🚀 转发请求到Claude Console API
  async relayRequest(
    requestBody,
    apiKeyData,
    clientRequest,
    clientResponse,
    clientHeaders,
    accountId,
    options = {}
  ) {
    let abortController = null
    let account = null

    try {
      // 获取账户信息
      account = await claudeConsoleAccountService.getAccount(accountId)
      if (!account) {
        throw new Error('Claude Console Claude account not found')
      }

      // logger.info('🔍 ===== Claude Console Account & Request Info =====')
      // logger.info(`📤 Processing Claude Console API request for key: ${apiKeyData.name || apiKeyData.id}, account: ${account.name} (${accountId})`)
      // logger.info(`🌐 Account API URL: ${account.apiUrl}`)
      // logger.info(`🔍 Account supportedModels: ${JSON.stringify(account.supportedModels)}`)
      // logger.info(`🔑 Account has apiKey: ${!!account.apiKey}`)
      // logger.info(`🔑 Account apiKey prefix: ${account.apiKey ? account.apiKey.substring(0, 10) + '...' : 'N/A'}`)
      // logger.info(`📝 Original request model: ${requestBody.model}`)
      // logger.info(`📝 Original request body: ${JSON.stringify(requestBody, null, 2)}`)
      // logger.info('🔍 ================================================')

      // 处理模型映射
      // logger.info('🔄 ===== Model Mapping Process =====')
      let mappedModel = requestBody.model
      if (
        account.supportedModels &&
        typeof account.supportedModels === 'object' &&
        !Array.isArray(account.supportedModels)
      ) {
        const newModel = claudeConsoleAccountService.getMappedModel(
          account.supportedModels,
          requestBody.model
        )
        if (newModel !== requestBody.model) {
          // logger.info(`🔄 Mapping model from ${requestBody.model} to ${newModel}`)
          mappedModel = newModel
        } else {
          // logger.info(`✅ Model ${requestBody.model} does not need mapping`)
        }
      } else {
        // logger.info(`✅ No model mapping needed (supportedModels: ${JSON.stringify(account.supportedModels)})`)
      }
      // logger.info(`📝 Final mapped model: ${mappedModel}`)
      // logger.info('🔄 ================================')

      // 创建修改后的请求体并注入 Claude Code 系统提示词
      // logger.info('📝 ===== Request Body Modification =====')
      let modifiedRequestBody = this._ensureClaudeCodeSystemPrompt({
        ...requestBody,
        model: mappedModel
      })
      // logger.info(`📝 After Claude Code system prompt injection: ${JSON.stringify(modifiedRequestBody, null, 2)}`)

      // 注入 metadata.user_id
      modifiedRequestBody = this._ensureMetadataUserId(modifiedRequestBody, accountId)
      // logger.info(`📝 After metadata.user_id injection: ${JSON.stringify(modifiedRequestBody, null, 2)}`)
      // logger.info('📝 =====================================')

      // 模型兼容性检查已经在调度器中完成，这里不需要再检查

      // 创建代理agent
      const proxyAgent = claudeConsoleAccountService._createProxyAgent(account.proxy)

      // 创建AbortController用于取消请求
      abortController = new AbortController()

      // 设置客户端断开监听器
      const handleClientDisconnect = () => {
        logger.info('🔌 Client disconnected, aborting Claude Console Claude request')
        if (abortController && !abortController.signal.aborted) {
          abortController.abort()
        }
      }

      // 监听客户端断开事件
      if (clientRequest) {
        clientRequest.once('close', handleClientDisconnect)
      }
      if (clientResponse) {
        clientResponse.once('close', handleClientDisconnect)
      }

      // 构建完整的API URL
      const cleanUrl = account.apiUrl.replace(/\/$/, '') // 移除末尾斜杠
      let apiEndpoint

      if (options.customPath) {
        // 如果指定了自定义路径（如 count_tokens），使用它
        const baseUrl = cleanUrl.replace(/\/v1\/messages$/, '') // 移除已有的 /v1/messages
        apiEndpoint = `${baseUrl}${options.customPath}`
      } else {
        // 默认使用 messages 端点
        apiEndpoint = cleanUrl.endsWith('/v1/messages') ? cleanUrl : `${cleanUrl}/v1/messages`
      }

      // 添加 ?beta=true 参数
      apiEndpoint += '?beta=true'

      logger.debug(`🎯 Final API endpoint: ${apiEndpoint}`)
      logger.debug(`[DEBUG] Options passed to relayRequest: ${JSON.stringify(options)}`)
      logger.debug(`[DEBUG] Client headers received: ${JSON.stringify(clientHeaders)}`)

      // 过滤客户端请求头
      const filteredHeaders = this._filterClientHeaders(clientHeaders)
      logger.debug(`[DEBUG] Filtered client headers: ${JSON.stringify(filteredHeaders)}`)

      // 决定使用的 User-Agent：优先使用账户自定义的，否则透传客户端的，最后才使用默认值
      const userAgent =
        account.userAgent ||
        clientHeaders?.['user-agent'] ||
        clientHeaders?.['User-Agent'] ||
        this.defaultUserAgent

      // 准备请求配置
      const requestConfig = {
        method: 'POST',
        url: apiEndpoint,
        data: modifiedRequestBody,
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'User-Agent': userAgent,
          ...filteredHeaders
        },
        httpsAgent: proxyAgent,
        timeout: config.requestTimeout || 600000,
        signal: abortController.signal,
        validateStatus: () => true // 接受所有状态码
      }

      // 添加 x-app: cli 请求头（如果不存在的话）
      if (!requestConfig.headers['x-app'] && !requestConfig.headers['X-App']) {
        requestConfig.headers['x-app'] = 'cli'
       logger.debug('[DEBUG] Added x-app: cli header')
      } else {
       logger.debug('[DEBUG] x-app header already exists, skipping')
      }

      // 添加额外的请求头
      requestConfig.headers['anthropic-beta'] = 'fine-grained-tool-streaming-2025-05-14'
      requestConfig.headers['anthropic-dangerous-direct-browser-access'] = 'true'
      requestConfig.headers['x-stainless-arch'] = 'x64'
      requestConfig.headers['x-stainless-helper-method'] = 'stream'
      requestConfig.headers['x-stainless-lang'] = 'js'
      requestConfig.headers['x-stainless-os'] = 'Windows'
      requestConfig.headers['x-stainless-package-version'] = '0.60.0'
      requestConfig.headers['x-stainless-retry-count'] = '0'
      requestConfig.headers['x-stainless-runtime'] = 'node'
      requestConfig.headers['x-stainless-runtime-version'] = 'v20.15.0'
      requestConfig.headers['x-stainless-timeout'] = '600'
      requestConfig.headers['accept-language'] = '*'
      requestConfig.headers['sec-fetch-mode'] = 'cors'
      logger.debug('[DEBUG] Added additional request headers')


      // 根据 API Key 格式选择认证方式
      if (account.apiKey && account.apiKey.startsWith('sk-ant-')) {
        // Anthropic 官方 API Key 使用 x-api-key
        requestConfig.headers['x-api-key'] = account.apiKey
        logger.debug('[DEBUG] Using x-api-key authentication for sk-ant-* API key')
      } else {
        // 其他 API Key 使用 Authorization Bearer
        requestConfig.headers['Authorization'] = `Bearer ${account.apiKey}`
        logger.debug('[DEBUG] Using Authorization Bearer authentication')
      }

      logger.debug(
        `[DEBUG] Initial headers before beta: ${JSON.stringify(requestConfig.headers, null, 2)}`
      )

      // 添加beta header如果需要
      if (options.betaHeader) {
        logger.debug(`[DEBUG] Adding beta header: ${options.betaHeader}`)
        requestConfig.headers['anthropic-beta'] = options.betaHeader
      } else {
        logger.debug('[DEBUG] No beta header to add')
      }

      // 发送请求前打印完整信息
      // logger.info('🚀 ===== Claude Console API Request Details =====')
      // logger.info(`📍 Request URL: ${requestConfig.url}`)
      // logger.info(`🔧 Request Method: ${requestConfig.method}`)
      // logger.info(`📋 Request Headers: ${JSON.stringify(requestConfig.headers, null, 2)}`)
      // logger.info(`📦 Request Body: ${JSON.stringify(requestConfig.data, null, 2)}`)
      // logger.info(`⏱️  Request Timeout: ${requestConfig.timeout}ms`)
      // logger.info('🚀 ================================================')

      const response = await axios(requestConfig)

      // 移除监听器（请求成功完成）
      if (clientRequest) {
        clientRequest.removeListener('close', handleClientDisconnect)
      }
      if (clientResponse) {
        clientResponse.removeListener('close', handleClientDisconnect)
      }

      // 打印响应信息
      // logger.info('📥 ===== Claude Console API Response Details =====')
      // logger.info(`🔗 Response Status: ${response.status}`)
      // logger.info(`📋 Response Headers: ${JSON.stringify(response.headers, null, 2)}`)
      // logger.info(`📦 Response Data Type: ${typeof response.data}`)
      // logger.info(`📏 Response Data Length: ${response.data ? (typeof response.data === 'string' ? response.data.length : JSON.stringify(response.data).length) : 0}`)
      //
      // // 打印响应数据（限制长度避免日志过长）
      // const responseDataStr = typeof response.data === 'string' ? response.data : JSON.stringify(response.data)
      // const maxLength = 1000
      // if (responseDataStr.length > maxLength) {
      //   logger.info(`📦 Response Data (first ${maxLength} chars): ${responseDataStr.substring(0, maxLength)}...`)
      //   logger.info(`📦 Response Data (last 200 chars): ...${responseDataStr.substring(responseDataStr.length - 200)}`)
      // } else {
      //   logger.info(`📦 Response Data: ${responseDataStr}`)
      // }
      // logger.info('📥 ================================================')

      // 检查错误状态并相应处理
      if (response.status === 401) {
        logger.warn(`🚫 Unauthorized error detected for Claude Console account ${accountId}`)
        await claudeConsoleAccountService.markAccountUnauthorized(accountId)
      } else if (response.status === 429) {
        logger.warn(`🚫 Rate limit detected for Claude Console account ${accountId}`)
        // 收到429先检查是否因为超过了手动配置的每日额度
        await claudeConsoleAccountService.checkQuotaUsage(accountId).catch((err) => {
          logger.error('❌ Failed to check quota after 429 error:', err)
        })

        await claudeConsoleAccountService.markAccountRateLimited(accountId)
      } else if (response.status === 529) {
        logger.warn(`🚫 Overload error detected for Claude Console account ${accountId}`)
        await claudeConsoleAccountService.markAccountOverloaded(accountId)
      } else if (response.status === 200 || response.status === 201) {
        // 如果请求成功，检查并移除错误状态
        const isRateLimited = await claudeConsoleAccountService.isAccountRateLimited(accountId)
        if (isRateLimited) {
          await claudeConsoleAccountService.removeAccountRateLimit(accountId)
        }
        const isOverloaded = await claudeConsoleAccountService.isAccountOverloaded(accountId)
        if (isOverloaded) {
          await claudeConsoleAccountService.removeAccountOverload(accountId)
        }
      }

      // 更新最后使用时间
      await this._updateLastUsedTime(accountId)

      const responseBody =
        typeof response.data === 'string' ? response.data : JSON.stringify(response.data)
      logger.debug(`[DEBUG] Final response body to return: ${responseBody}`)

      return {
        statusCode: response.status,
        headers: response.headers,
        body: responseBody,
        accountId
      }
    } catch (error) {
      // 处理特定错误
      if (error.name === 'AbortError' || error.code === 'ECONNABORTED') {
        logger.info('Request aborted due to client disconnect')
        throw new Error('Client disconnected')
      }

      logger.error(
        `❌ Claude Console relay request failed (Account: ${account?.name || accountId}):`,
        error.message
      )

      // 不再因为模型不支持而block账号

      throw error
    }
  }

  // 🌊 处理流式响应
  async relayStreamRequestWithUsageCapture(
    requestBody,
    apiKeyData,
    responseStream,
    clientHeaders,
    usageCallback,
    accountId,
    streamTransformer = null,
    options = {}
  ) {
    let account = null
    try {
      // 获取账户信息
      account = await claudeConsoleAccountService.getAccount(accountId)
      if (!account) {
        throw new Error('Claude Console Claude account not found')
      }

      logger.info(
        `📡 Processing streaming Claude Console API request for key: ${apiKeyData.name || apiKeyData.id}, account: ${account.name} (${accountId})`
      )
      logger.debug(`🌐 Account API URL: ${account.apiUrl}`)

      // 处理模型映射
      let mappedModel = requestBody.model
      if (
        account.supportedModels &&
        typeof account.supportedModels === 'object' &&
        !Array.isArray(account.supportedModels)
      ) {
        const newModel = claudeConsoleAccountService.getMappedModel(
          account.supportedModels,
          requestBody.model
        )
        if (newModel !== requestBody.model) {
          logger.info(`🔄 [Stream] Mapping model from ${requestBody.model} to ${newModel}`)
          mappedModel = newModel
        }
      }

      // 创建修改后的请求体并注入 Claude Code 系统提示词
      let modifiedRequestBody = this._ensureClaudeCodeSystemPrompt({
        ...requestBody,
        model: mappedModel
      })
      // 注入 metadata.user_id（流式）
      modifiedRequestBody = this._ensureMetadataUserId(modifiedRequestBody, accountId)

      // 模型兼容性检查已经在调度器中完成，这里不需要再检查

      // 创建代理agent
      const proxyAgent = claudeConsoleAccountService._createProxyAgent(account.proxy)

      // 发送流式请求
      await this._makeClaudeConsoleStreamRequest(
        modifiedRequestBody,
        account,
        proxyAgent,
        clientHeaders,
        responseStream,
        accountId,
        usageCallback,
        streamTransformer,
        options
      )

      // 更新最后使用时间
      await this._updateLastUsedTime(accountId)
    } catch (error) {
      logger.error(
        `❌ Claude Console stream relay failed (Account: ${account?.name || accountId}):`,
        error
      )
      throw error
    }
  }

  // 🌊 发送流式请求到Claude Console API
  async _makeClaudeConsoleStreamRequest(
    body,
    account,
    proxyAgent,
    clientHeaders,
    responseStream,
    accountId,
    usageCallback,
    streamTransformer = null,
    requestOptions = {}
  ) {
    return new Promise((resolve, reject) => {
      let aborted = false

      // 构建完整的API URL
      const cleanUrl = account.apiUrl.replace(/\/$/, '') // 移除末尾斜杠
      let apiEndpoint = cleanUrl.endsWith('/v1/messages') ? cleanUrl : `${cleanUrl}/v1/messages`

      // 添加 ?beta=true 参数
      apiEndpoint += '?beta=true'

      logger.debug(`🎯 Final API endpoint for stream: ${apiEndpoint}`)

      // 过滤客户端请求头
      const filteredHeaders = this._filterClientHeaders(clientHeaders)
      logger.debug(`[DEBUG] Filtered client headers: ${JSON.stringify(filteredHeaders)}`)

      // 决定使用的 User-Agent：优先使用账户自定义的，否则透传客户端的，最后才使用默认值
      const userAgent =
        account.userAgent ||
        clientHeaders?.['user-agent'] ||
        clientHeaders?.['User-Agent'] ||
        this.defaultUserAgent

      // 准备请求配置
      const requestConfig = {
        method: 'POST',
        url: apiEndpoint,
        data: body,
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'User-Agent': userAgent,
          ...filteredHeaders
        },
        httpsAgent: proxyAgent,
        timeout: config.requestTimeout || 600000,
        responseType: 'stream',
        validateStatus: () => true // 接受所有状态码
      }

       // 添加 x-app: cli 请求头（如果不存在的话）
       if (!requestConfig.headers['x-app'] && !requestConfig.headers['X-App']) {
         requestConfig.headers['x-app'] = 'cli'
         logger.debug('[DEBUG] Added x-app: cli header for stream')
       } else {
         logger.debug('[DEBUG] x-app header already exists for stream, skipping')
       }

       // 添加额外的请求头（流式）
       requestConfig.headers['anthropic-beta'] = 'fine-grained-tool-streaming-2025-05-14'
       requestConfig.headers['anthropic-dangerous-direct-browser-access'] = 'true'
       requestConfig.headers['x-stainless-arch'] = 'x64'
       requestConfig.headers['x-stainless-helper-method'] = 'stream'
       requestConfig.headers['x-stainless-lang'] = 'js'
       requestConfig.headers['x-stainless-os'] = 'Windows'
       requestConfig.headers['x-stainless-package-version'] = '0.60.0'
       requestConfig.headers['x-stainless-retry-count'] = '0'
       requestConfig.headers['x-stainless-runtime'] = 'node'
       requestConfig.headers['x-stainless-runtime-version'] = 'v20.15.0'
       requestConfig.headers['x-stainless-timeout'] = '600'
       requestConfig.headers['accept-language'] = '*'
       requestConfig.headers['sec-fetch-mode'] = 'cors'
       logger.debug('[DEBUG] Added additional request headers for stream')


      // 根据 API Key 格式选择认证方式
      if (account.apiKey && account.apiKey.startsWith('sk-ant-')) {
        // Anthropic 官方 API Key 使用 x-api-key
        requestConfig.headers['x-api-key'] = account.apiKey
        logger.debug('[DEBUG] Using x-api-key authentication for sk-ant-* API key')
      } else {
        // 其他 API Key 使用 Authorization Bearer
        requestConfig.headers['Authorization'] = `Bearer ${account.apiKey}`
        logger.debug('[DEBUG] Using Authorization Bearer authentication')
      }

      // 添加beta header如果需要
      if (requestOptions.betaHeader) {
        requestConfig.headers['anthropic-beta'] = requestOptions.betaHeader
      }

      // 发送请求
      const request = axios(requestConfig)

      request
        .then((response) => {
          logger.debug(`🌊 Claude Console Claude stream response status: ${response.status}`)

          // 错误响应处理
          if (response.status !== 200) {
            logger.error(
              `❌ Claude Console API returned error status: ${response.status} | Account: ${account?.name || accountId}`
            )

            if (response.status === 401) {
              claudeConsoleAccountService.markAccountUnauthorized(accountId)
            } else if (response.status === 429) {
              claudeConsoleAccountService.markAccountRateLimited(accountId)
              // 检查是否因为超过每日额度
              claudeConsoleAccountService.checkQuotaUsage(accountId).catch((err) => {
                logger.error('❌ Failed to check quota after 429 error:', err)
              })
            } else if (response.status === 529) {
              claudeConsoleAccountService.markAccountOverloaded(accountId)
            }

            // 设置错误响应的状态码和响应头
            if (!responseStream.headersSent) {
              const errorHeaders = {
                'Content-Type': response.headers['content-type'] || 'application/json',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive'
              }
              // 避免 Transfer-Encoding 冲突，让 Express 自动处理
              delete errorHeaders['Transfer-Encoding']
              delete errorHeaders['Content-Length']
              responseStream.writeHead(response.status, errorHeaders)
            }

            // 直接透传错误数据，不进行包装
            response.data.on('data', (chunk) => {
              if (!responseStream.destroyed) {
                responseStream.write(chunk)
              }
            })

            response.data.on('end', () => {
              if (!responseStream.destroyed) {
                responseStream.end()
              }
              resolve() // 不抛出异常，正常完成流处理
            })
            return
          }

          // 成功响应，检查并移除错误状态
          claudeConsoleAccountService.isAccountRateLimited(accountId).then((isRateLimited) => {
            if (isRateLimited) {
              claudeConsoleAccountService.removeAccountRateLimit(accountId)
            }
          })
          claudeConsoleAccountService.isAccountOverloaded(accountId).then((isOverloaded) => {
            if (isOverloaded) {
              claudeConsoleAccountService.removeAccountOverload(accountId)
            }
          })

          // 设置响应头
          if (!responseStream.headersSent) {
            responseStream.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
              'X-Accel-Buffering': 'no'
            })
          }

          let buffer = ''
          let finalUsageReported = false
          const collectedUsageData = {}

          // 处理流数据
          response.data.on('data', (chunk) => {
            try {
              if (aborted) {
                return
              }

              const chunkStr = chunk.toString()
              buffer += chunkStr

              // 处理完整的SSE行
              const lines = buffer.split('\n')
              buffer = lines.pop() || ''

              // 转发数据并解析usage
              if (lines.length > 0 && !responseStream.destroyed) {
                const linesToForward = lines.join('\n') + (lines.length > 0 ? '\n' : '')

                // 应用流转换器如果有
                if (streamTransformer) {
                  const transformed = streamTransformer(linesToForward)
                  if (transformed) {
                    responseStream.write(transformed)
                  }
                } else {
                  responseStream.write(linesToForward)
                }

                // 解析SSE数据寻找usage信息
                for (const line of lines) {
                  if (line.startsWith('data: ') && line.length > 6) {
                    try {
                      const jsonStr = line.slice(6)
                      const data = JSON.parse(jsonStr)

                      // 收集usage数据
                      if (data.type === 'message_start' && data.message && data.message.usage) {
                        collectedUsageData.input_tokens = data.message.usage.input_tokens || 0
                        collectedUsageData.cache_creation_input_tokens =
                          data.message.usage.cache_creation_input_tokens || 0
                        collectedUsageData.cache_read_input_tokens =
                          data.message.usage.cache_read_input_tokens || 0
                        collectedUsageData.model = data.message.model

                        // 检查是否有详细的 cache_creation 对象
                        if (
                          data.message.usage.cache_creation &&
                          typeof data.message.usage.cache_creation === 'object'
                        ) {
                          collectedUsageData.cache_creation = {
                            ephemeral_5m_input_tokens:
                              data.message.usage.cache_creation.ephemeral_5m_input_tokens || 0,
                            ephemeral_1h_input_tokens:
                              data.message.usage.cache_creation.ephemeral_1h_input_tokens || 0
                          }
                          logger.info(
                            '📊 Collected detailed cache creation data:',
                            JSON.stringify(collectedUsageData.cache_creation)
                          )
                        }
                      }

                      if (
                        data.type === 'message_delta' &&
                        data.usage &&
                        data.usage.output_tokens !== undefined
                      ) {
                        collectedUsageData.output_tokens = data.usage.output_tokens || 0

                        if (collectedUsageData.input_tokens !== undefined && !finalUsageReported) {
                          usageCallback({ ...collectedUsageData, accountId })
                          finalUsageReported = true
                        }
                      }

                      // 不再因为模型不支持而block账号
                    } catch (e) {
                      // 忽略解析错误
                    }
                  }
                }
              }
            } catch (error) {
              logger.error(
                `❌ Error processing Claude Console stream data (Account: ${account?.name || accountId}):`,
                error
              )
              if (!responseStream.destroyed) {
                responseStream.write('event: error\n')
                responseStream.write(
                  `data: ${JSON.stringify({
                    error: 'Stream processing error',
                    message: error.message,
                    timestamp: new Date().toISOString()
                  })}\n\n`
                )
              }
            }
          })

          response.data.on('end', () => {
            try {
              // 处理缓冲区中剩余的数据
              if (buffer.trim() && !responseStream.destroyed) {
                if (streamTransformer) {
                  const transformed = streamTransformer(buffer)
                  if (transformed) {
                    responseStream.write(transformed)
                  }
                } else {
                  responseStream.write(buffer)
                }
              }

              // 确保流正确结束
              if (!responseStream.destroyed) {
                responseStream.end()
              }

              logger.debug('🌊 Claude Console Claude stream response completed')
              resolve()
            } catch (error) {
              logger.error('❌ Error processing stream end:', error)
              reject(error)
            }
          })

          response.data.on('error', (error) => {
            logger.error(
              `❌ Claude Console stream error (Account: ${account?.name || accountId}):`,
              error
            )
            if (!responseStream.destroyed) {
              responseStream.write('event: error\n')
              responseStream.write(
                `data: ${JSON.stringify({
                  error: 'Stream error',
                  message: error.message,
                  timestamp: new Date().toISOString()
                })}\n\n`
              )
              responseStream.end()
            }
            reject(error)
          })
        })
        .catch((error) => {
          if (aborted) {
            return
          }

          logger.error(
            `❌ Claude Console stream request error (Account: ${account?.name || accountId}):`,
            error.message
          )

          // 检查错误状态
          if (error.response) {
            if (error.response.status === 401) {
              claudeConsoleAccountService.markAccountUnauthorized(accountId)
            } else if (error.response.status === 429) {
              claudeConsoleAccountService.markAccountRateLimited(accountId)
              // 检查是否因为超过每日额度
              claudeConsoleAccountService.checkQuotaUsage(accountId).catch((err) => {
                logger.error('❌ Failed to check quota after 429 error:', err)
              })
            } else if (error.response.status === 529) {
              claudeConsoleAccountService.markAccountOverloaded(accountId)
            }
          }

          // 发送错误响应
          if (!responseStream.headersSent) {
            responseStream.writeHead(error.response?.status || 500, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive'
            })
          }

          if (!responseStream.destroyed) {
            responseStream.write('event: error\n')
            responseStream.write(
              `data: ${JSON.stringify({
                error: error.message,
                code: error.code,
                timestamp: new Date().toISOString()
              })}\n\n`
            )
            responseStream.end()
          }

          reject(error)
        })

      // 处理客户端断开连接
      responseStream.on('close', () => {
        logger.debug('🔌 Client disconnected, cleaning up Claude Console stream')
        aborted = true
      })
    })
  }

  // 🧩 确保包含 metadata.user_id，格式类似示例：
  // user_<sha256hex>_account__session_<uuid or sessionHash>
  _ensureMetadataUserId(body, accountId) {
    try {
      if (!body || typeof body !== 'object') return body
      const clone = JSON.parse(JSON.stringify(body))

      // 生成基于账号ID的唯一sha256hex
      const crypto = require('crypto')
      const accountHash = crypto.createHash('sha256').update(`account_${accountId}`).digest('hex')

      // 生成基于日期的sessionHash（每天更换，UUID格式带横线）
      const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD格式
      const sessionHashHex = crypto.createHash('sha256').update(`session_${accountId}_${today}`).digest('hex')
      // 将64位hex转换为UUID格式：xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
      const sessionHash = sessionHashHex.substring(0, 8) + '-' +
                         sessionHashHex.substring(8, 12) + '-' +
                         sessionHashHex.substring(12, 16) + '-' +
                         sessionHashHex.substring(16, 20) + '-' +
                         sessionHashHex.substring(20, 32)

      const userId = `user_${accountHash}_account__session_${sessionHash}`

      // 打印生成的userId日志
      logger.info(`🔑 Generated userId for account ${accountId}: ${userId}`)

      if (!clone.metadata || typeof clone.metadata !== 'object') {
        clone.metadata = { user_id: userId }
      } else {
        clone.metadata.user_id = userId
      }
      return clone
    } catch (e) {
      return body
    }
  }

  // 🔧 过滤客户端请求头
  _filterClientHeaders(clientHeaders) {
    const sensitiveHeaders = [
      'content-type',
      'user-agent',
      'authorization',
      'x-api-key',
      'host',
      'content-length',
      'connection',
      'proxy-authorization',
      'content-encoding',
      'transfer-encoding',
      'anthropic-version'
    ]

    const filteredHeaders = {}

    Object.keys(clientHeaders || {}).forEach((key) => {
      const lowerKey = key.toLowerCase()
      if (!sensitiveHeaders.includes(lowerKey)) {
        filteredHeaders[key] = clientHeaders[key]
      }
    })

    return filteredHeaders
  }

  // 🧩 确保请求体包含 Claude Code 系统提示词（最前置）
  _ensureClaudeCodeSystemPrompt(body) {
    try {
      if (!body) return body

      // 深拷贝，避免副作用
      const processedBody = JSON.parse(JSON.stringify(body))

      const claudeCodePrompt = {
        type: 'text',
        text: this.claudeCodeSystemPrompt,
        cache_control: { type: 'ephemeral' }
      }

       // 添加 system-reminder 消息到 messages 前面
       if (processedBody.messages && Array.isArray(processedBody.messages)) {
         // 创建包含两个 system-reminder 的 user 角色消息
         const systemReminderMessage = {
           role: "user",
           content: [
             {
               type: "text",
               text: "<system-reminder></system-reminder>"
             },
             {
               type: "text",
               text: "<system-reminder></system-reminder>"
             }
           ]
         }

         // 将 system-reminder 消息插入到 messages 数组的第一个位置
         processedBody.messages.unshift(systemReminderMessage)
         // logger.debug('[DEBUG] Added system-reminder message to messages array')
       }

      if (processedBody.system) {
        if (typeof processedBody.system === 'string') {
          const userSystemPrompt = { type: 'text', text: processedBody.system }
          if (processedBody.system.trim() === this.claudeCodeSystemPrompt) {
            processedBody.system = [claudeCodePrompt]
          } else {
            processedBody.system = [claudeCodePrompt, userSystemPrompt]
          }
        } else if (Array.isArray(processedBody.system)) {
          const firstItem = processedBody.system[0]
          const isFirstClaudeCode =
            firstItem && firstItem.type === 'text' && firstItem.text === this.claudeCodeSystemPrompt
          if (!isFirstClaudeCode) {
            const filteredSystem = processedBody.system.filter(
              (item) => !(item && item.type === 'text' && item.text === this.claudeCodeSystemPrompt)
            )
            processedBody.system = [claudeCodePrompt, ...filteredSystem]
          }
        } else {
          // 未知类型，回落为仅注入 Claude Code 提示词
          processedBody.system = [claudeCodePrompt]
        }
      } else {
        processedBody.system = [claudeCodePrompt]
      }

      return processedBody
    } catch (e) {
      // 出现异常时，不阻断请求，原样返回
      return body
    }
  }

  // 🕐 更新最后使用时间
  async _updateLastUsedTime(accountId) {
    try {
      const client = require('../models/redis').getClientSafe()
      await client.hset(
        `claude_console_account:${accountId}`,
        'lastUsedAt',
        new Date().toISOString()
      )
    } catch (error) {
      logger.warn(
        `⚠️ Failed to update last used time for Claude Console account ${accountId}:`,
        error.message
      )
    }
  }

  // 🎯 健康检查
  async healthCheck() {
    try {
      const accounts = await claudeConsoleAccountService.getAllAccounts()
      const activeAccounts = accounts.filter((acc) => acc.isActive && acc.status === 'active')

      return {
        healthy: activeAccounts.length > 0,
        activeAccounts: activeAccounts.length,
        totalAccounts: accounts.length,
        timestamp: new Date().toISOString()
      }
    } catch (error) {
      logger.error('❌ Claude Console Claude health check failed:', error)
      return {
        healthy: false,
        error: error.message,
        timestamp: new Date().toISOString()
      }
    }
  }
}

module.exports = new ClaudeConsoleRelayService()
