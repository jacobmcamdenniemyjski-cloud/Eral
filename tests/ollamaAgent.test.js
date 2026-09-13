const test = require('node:test')
const assert = require('node:assert/strict')
const OllamaAgent = require('../src/llm/OllamaAgent')
const OllamaProvider = require('../src/llm/OllamaProvider')
const { toOllamaTools } = require('../src/llm/OllamaAgent')

function createRegistry(execute = async (name, input) => ({
  ok: true,
  skill: name,
  data: input
})) {
  return {
    getToolDefinitions: () => [{
      name: 'get_status',
      description: 'Read Earl status.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false
      }
    }],
    execute
  }
}

function createProvider(responses) {
  const requests = []
  return {
    requests,
    async chat(request) {
      requests.push(request)
      return responses.shift()
    },
    async getStatus() {
      return { connected: true, modelInstalled: true, model: 'test-model' }
    }
  }
}

test('registry definitions become Ollama function tools', () => {
  const tools = toOllamaTools(createRegistry())

  assert.deepEqual(tools, [{
    type: 'function',
    function: {
      name: 'get_status',
      description: 'Read Earl status.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false
      }
    }
  }])
})

test('agent executes a requested skill and returns its result to Ollama', async () => {
  const provider = createProvider([
    {
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [{
          function: { name: 'get_status', arguments: {} }
        }]
      }
    },
    {
      message: {
        role: 'assistant',
        content: 'You have full health.'
      }
    }
  ])
  const calls = []
  const registry = createRegistry(async (name, input, context) => {
    calls.push({ name, input, context })
    return { ok: true, skill: name, data: { health: 20 } }
  })
  const agent = new OllamaAgent({ provider, skillRegistry: registry })
  const controller = new AbortController()
  const result = await agent.ask('jacob48317', 'How are you?', {
    signal: controller.signal
  })

  assert.equal(result.ok, true)
  assert.equal(result.message, 'You have full health.')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, 'get_status')
  assert.equal(calls[0].context.signal, controller.signal)
  assert.equal(provider.requests.length, 2)

  const toolMessage = provider.requests[1].messages
    .filter((message) => message.role === 'tool')
    .at(-1)
  assert.equal(toolMessage.role, 'tool')
  assert.equal(toolMessage.tool_name, 'get_status')
  assert.deepEqual(JSON.parse(toolMessage.content), {
    ok: true,
    skill: 'get_status',
    data: { health: 20 }
  })
})

test('agent keeps short, separate conversation histories per player', async () => {
  const provider = createProvider([
    { message: { role: 'assistant', content: 'Hello Jacob.' } },
    { message: { role: 'assistant', content: 'Welcome back.' } },
    { message: { role: 'assistant', content: 'Hello Alex.' } }
  ])
  const agent = new OllamaAgent({
    provider,
    skillRegistry: createRegistry(),
    historyLimit: 4
  })

  await agent.ask('jacob48317', 'Hello')
  await agent.ask('jacob48317', 'Remember me?')
  await agent.ask('alex', 'Hello')

  const jacobMessages = provider.requests[1].messages
  const alexMessages = provider.requests[2].messages
  assert.ok(jacobMessages.some((message) => message.content === 'Hello Jacob.'))
  assert.equal(alexMessages.some((message) => message.content === 'Hello Jacob.'), false)
})

test('agent stops a model that exceeds its tool-call limit', async () => {
  const toolResponse = {
    message: {
      role: 'assistant',
      content: '',
      tool_calls: [{ function: { name: 'get_status', arguments: {} } }]
    }
  }
  const provider = createProvider([toolResponse, toolResponse])
  const agent = new OllamaAgent({
    provider,
    skillRegistry: createRegistry(),
    maxToolCalls: 1
  })

  const result = await agent.ask('jacob48317', 'Loop forever')

  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'TOOL_LIMIT')
  assert.equal(result.tools.length, 1)
})

test('agent propagates cancellation instead of continuing the loop', async () => {
  const controller = new AbortController()
  const provider = {
    async chat({ signal }) {
      controller.abort(new Error('stopped by player'))
      throw signal.reason
    }
  }
  const agent = new OllamaAgent({
    provider,
    skillRegistry: createRegistry()
  })

  await assert.rejects(
    agent.ask('jacob48317', 'Do something', { signal: controller.signal }),
    /stopped by player/
  )
})

test('provider reports whether its configured model is installed', async () => {
  const provider = new OllamaProvider({
    model: 'qwen3:4b',
    fetch: async () => new Response(JSON.stringify({
      models: [{ model: 'qwen3:4b' }, { model: 'other:latest' }]
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  })

  const status = await provider.getStatus()

  assert.equal(status.connected, true)
  assert.equal(status.modelInstalled, true)
  assert.deepEqual(status.models, ['qwen3:4b', 'other:latest'])
})

test('provider sends non-streaming tool calls through the official client', async () => {
  let requestBody
  const provider = new OllamaProvider({
    model: 'qwen3:4b',
    numCtx: 8192,
    fetch: async (url, init) => {
      requestBody = JSON.parse(init.body)
      return new Response(JSON.stringify({
        message: { role: 'assistant', content: 'Ready.' },
        done: true
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
  })

  const tools = toOllamaTools(createRegistry())
  const response = await provider.chat({
    messages: [{ role: 'user', content: 'Status?' }],
    tools
  })

  assert.equal(requestBody.model, 'qwen3:4b')
  assert.equal(requestBody.stream, false)
  assert.equal(requestBody.options.num_ctx, 8192)
  assert.deepEqual(requestBody.tools, tools)
  assert.equal(response.message.content, 'Ready.')
})
