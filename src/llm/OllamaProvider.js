const { Ollama } = require('ollama')

function createTimeoutError(ms) {
  const error = new Error(`Ollama did not respond within ${ms}ms.`)
  error.code = 'OLLAMA_TIMEOUT'
  return error
}

function isGptOssModel(model) {
  return /gpt-oss/i.test(String(model || ''))
}

function normalizeThinkOption(value, model) {
  if (value === undefined || value === null || value === '') {
    return isGptOssModel(model) ? 'low' : false
  }

  const normalized = typeof value === 'string'
    ? value.trim().toLowerCase()
    : value

  if (isGptOssModel(model)) {
    if (['low', 'medium', 'high'].includes(normalized)) return normalized
    return 'low'
  }

  if (normalized === true || normalized === 'true') return true
  return false
}

class OllamaProvider {
  constructor(options = {}) {
    this.host = options.host || 'http://127.0.0.1:11434'
    this.model = options.model || 'qwen3:4b-instruct'
    this.think = normalizeThinkOption(options.think, this.model)
    this.numCtx = options.numCtx || 4096
    this.numPredict = options.numPredict || 384
    this.temperature = options.temperature ?? 0.2
    this.keepAlive = options.keepAlive || '10m'
    this.requestTimeoutMs = options.requestTimeoutMs || 180000
    this.fetch = options.fetch || globalThis.fetch
  }

  async request(operation, options = {}) {
    const { signal: externalSignal } = options
    const timeoutMs = options.timeoutMs || this.requestTimeoutMs
    const controller = new AbortController()
    const timeoutError = createTimeoutError(timeoutMs)
    const timer = setTimeout(() => controller.abort(timeoutError), timeoutMs)
    const onExternalAbort = () => controller.abort(
      externalSignal.reason || new Error('Ollama request was cancelled.')
    )

    if (externalSignal) {
      if (externalSignal.aborted) {
        onExternalAbort()
      } else {
        externalSignal.addEventListener('abort', onExternalAbort, { once: true })
      }
    }

    const client = new Ollama({
      host: this.host,
      fetch: (url, init = {}) => this.fetch(url, {
        ...init,
        signal: controller.signal
      })
    })

    try {
      if (controller.signal.aborted) throw controller.signal.reason
      return await operation(client)
    } catch (error) {
      if (controller.signal.aborted) {
        throw controller.signal.reason || error
      }

      const wrapped = new Error(
        `Could not reach Ollama at ${this.host}: ${error.message}`
      )
      wrapped.code = 'OLLAMA_REQUEST_FAILED'
      wrapped.cause = error
      throw wrapped
    } finally {
      clearTimeout(timer)
      if (externalSignal) {
        externalSignal.removeEventListener('abort', onExternalAbort)
      }
    }
  }

  async chat({ messages, tools, signal, numCtx, numPredict }) {
    const request = {
      model: this.model,
      messages,
      stream: false,
      think: this.think,
      keep_alive: this.keepAlive,
      options: {
        num_ctx: numCtx || this.numCtx,
        num_predict: numPredict || this.numPredict,
        temperature: this.temperature
      }
    }

    if (tools && tools.length > 0) request.tools = tools

    return this.request((client) => client.chat(request), { signal })
  }

  async getStatus(options = {}) {
    try {
      const response = await this.request((client) => client.list(), options)
      const models = (response.models || []).map((entry) => (
        entry.model || entry.name
      )).filter(Boolean)

      return {
        connected: true,
        host: this.host,
        model: this.model,
        modelInstalled: models.includes(this.model),
        models
      }
    } catch (error) {
      return {
        connected: false,
        host: this.host,
        model: this.model,
        modelInstalled: false,
        models: [],
        error: error.message
      }
    }
  }
}

module.exports = OllamaProvider
module.exports.normalizeThinkOption = normalizeThinkOption
