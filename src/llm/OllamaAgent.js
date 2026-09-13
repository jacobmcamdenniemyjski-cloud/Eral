const selectSkillTools = require('./selectSkillTools')

function toOllamaTools(source) {
  const definitions = Array.isArray(source)
    ? source
    : source.getToolDefinitions()

  return definitions.map((definition) => ({
    type: 'function',
    function: {
      name: definition.name,
      description: definition.description,
      parameters: definition.inputSchema
    }
  }))
}

function parseArguments(value) {
  if (!value) return {}
  if (typeof value === 'object') return value

  try {
    return JSON.parse(value)
  } catch (error) {
    return {}
  }
}

const REASONING_OUTPUT_PATTERN = new RegExp([
  'the user (?:wants|asked|is asking)',
  'let me (?:think|check|see)',
  'i (?:first|now) (?:need to|should|will)',
  'i need to (?:call|use|check|determine)',
  'the (?:available )?tools? (?:are|include)',
  'the instructions say',
  'the response should'
].join('|'), 'i')

function fallbackReply(prompt, executedTools) {
  const quotedSpeech = String(prompt).match(/\bsay\s+["“'](.+?)["”']/i)
  if (quotedSpeech) return quotedSpeech[1].slice(0, 220)
  if (/\b(?:say\s+)?(?:hello|hi|hey)\b/i.test(prompt)) return 'Hello!'

  const lastTool = executedTools.at(-1)
  if (lastTool && lastTool.result && lastTool.result.ok) return 'Done.'
  if (lastTool && lastTool.result && lastTool.result.error) {
    return lastTool.result.error.message || 'I could not complete that.'
  }

  return 'I could not produce a concise answer.'
}

function finalizeReply(rawReply, prompt, executedTools) {
  const reply = String(rawReply || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<analysis>[\s\S]*?<\/analysis>/gi, '')
    .trim()

  if (
    !reply ||
    REASONING_OUTPUT_PATTERN.test(reply) ||
    reply.length > 440
  ) {
    return fallbackReply(prompt, executedTools)
  }

  return reply
}

function buildSystemPrompt(username) {
  return [
    'You are Earl, a capable Minecraft companion controlled through tools.',
    `The player speaking to you is ${username}.`,
    'Use an available tool for every Minecraft observation or action. Never invent results.',
    'Only change the world, inventory, movement, or combat when the player asks.',
    'Execute dependent steps in order and inspect each tool result before continuing.',
    'When make_item is available, call it immediately for every make or craft request. It is the sole authority on recipes; never calculate Minecraft recipes yourself.',
    'The store_item skill finds nearby chests and barrels itself. Never scan for a container before storing.',
    'Pass generic resource words such as log, logs, wood, or trees to tools instead of rejecting them yourself.',
    'If a tool fails, explain the real failure or safely try a reasonable correction.',
    'Never claim an action succeeded unless its tool result has ok=true.',
    'Keep the final Minecraft chat response to two short sentences.',
    'Return only the final response; never reveal analysis, planning, or scratch work.',
    '/no_think'
  ].join(' ')
}

class OllamaAgent {
  constructor(options) {
    this.provider = options.provider
    this.skillRegistry = options.skillRegistry
    this.maxToolRounds = options.maxToolRounds || 6
    this.maxToolCalls = options.maxToolCalls || 12
    this.historyLimit = options.historyLimit || 8
    this.maxSelectedTools = options.maxSelectedTools || 10
    this.log = options.log || ((message) => console.log(message))
    this.histories = new Map()
  }

  getHistory(username) {
    return this.histories.get(username) || []
  }

  remember(username, userContent, assistantContent) {
    const history = [
      ...this.getHistory(username),
      { role: 'user', content: userContent },
      { role: 'assistant', content: assistantContent }
    ].slice(-this.historyLimit)

    this.histories.set(username, history)
  }

  clearHistory(username) {
    this.histories.delete(username)
  }

  async getStatus(options = {}) {
    return this.provider.getStatus(options)
  }

  async ask(username, prompt, context = {}) {
    const content = String(prompt || '').trim()
    if (!content) {
      return {
        ok: false,
        error: { code: 'EMPTY_PROMPT', message: 'Tell Earl what you want.' }
      }
    }

    const messages = [
      { role: 'system', content: buildSystemPrompt(username) },
      ...this.getHistory(username),
      { role: 'user', content: `${content}\n/no_think` }
    ]
    const definitions = this.skillRegistry.getToolDefinitions()
    const selectedDefinitions = selectSkillTools(content, definitions, {
      maxTools: this.maxSelectedTools
    })
    const allowedToolNames = new Set(
      selectedDefinitions.map((definition) => definition.name)
    )
    const tools = toOllamaTools(selectedDefinitions)
    const executedTools = []
    const requestStartedAt = Date.now()

    this.log(
      `[llm] selected tools for ${username}: ` +
      `${[...allowedToolNames].join(', ') || 'none'}`
    )

    try {
      for (let round = 0; round < this.maxToolRounds; round += 1) {
        if (context.signal && context.signal.aborted) {
          throw context.signal.reason || new Error('Earl request was cancelled.')
        }

        const roundStartedAt = Date.now()
        let response

        try {
          response = await this.provider.chat({
            messages,
            tools,
            signal: context.signal
          })
        } finally {
          const seconds = ((Date.now() - roundStartedAt) / 1000).toFixed(1)
          this.log(`[llm] round ${round + 1} finished in ${seconds}s`)
        }
        const received = response.message || {}
        const toolCalls = received.tool_calls || []
        const assistantMessage = {
          role: 'assistant',
          content: received.content || ''
        }

        if (received.thinking) assistantMessage.thinking = received.thinking
        if (toolCalls.length) assistantMessage.tool_calls = toolCalls
        messages.push(assistantMessage)

        if (toolCalls.length === 0) {
          const reply = finalizeReply(
            assistantMessage.content,
            content,
            executedTools
          )
          this.remember(username, content, reply)
          return { ok: true, message: reply, tools: executedTools }
        }

        const roundResults = new Map()

        for (const call of toolCalls) {
          if (executedTools.length >= this.maxToolCalls) {
            return {
              ok: false,
              error: {
                code: 'TOOL_LIMIT',
                message: 'The request needed too many Minecraft actions.'
              },
              tools: executedTools
            }
          }

          if (context.signal && context.signal.aborted) {
            throw context.signal.reason || new Error('Earl request was cancelled.')
          }

          const name = call.function && call.function.name
          const input = parseArguments(
            call.function && call.function.arguments
          )
          const signature = `${name}:${JSON.stringify(input)}`
          const duplicate = roundResults.has(signature)
          let result

          if (duplicate) {
            result = roundResults.get(signature)
            this.log(`[llm] skipped duplicate call to ${name}`)
          } else if (!allowedToolNames.has(name)) {
            result = {
              ok: false,
              skill: name || 'unknown_tool',
              error: {
                code: 'TOOL_NOT_ALLOWED',
                message: `Tool ${name || 'unknown_tool'} was not enabled for this request.`
              }
            }
          } else {
            this.log(`[llm] calling ${name} with ${JSON.stringify(input)}`)
            result = await this.skillRegistry.execute(name, input, context)
          }

          roundResults.set(signature, result)
          executedTools.push({ name, input, result, duplicate })

          if (context.signal && context.signal.aborted) {
            throw context.signal.reason || new Error('Earl request was cancelled.')
          }

          messages.push({
            role: 'tool',
            tool_name: name,
            content: JSON.stringify(result)
          })
        }
      }

      return {
        ok: false,
        error: {
          code: 'ROUND_LIMIT',
          message: 'The model could not finish the request safely.'
        },
        tools: executedTools
      }
    } catch (error) {
      if (context.signal && context.signal.aborted) throw error

      return {
        ok: false,
        error: {
          code: error.code || 'OLLAMA_ERROR',
          message: error.message
        },
        tools: executedTools
      }
    } finally {
      const seconds = ((Date.now() - requestStartedAt) / 1000).toFixed(1)
      this.log(`[llm] request finished in ${seconds}s`)
    }
  }
}

module.exports = OllamaAgent
module.exports.toOllamaTools = toOllamaTools
module.exports.finalizeReply = finalizeReply
