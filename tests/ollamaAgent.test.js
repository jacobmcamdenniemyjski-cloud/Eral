const test = require('node:test')
const assert = require('node:assert/strict')
const OllamaAgent = require('../src/llm/OllamaAgent')
const OllamaProvider = require('../src/llm/OllamaProvider')
const { toOllamaTools, finalizeReply } = require('../src/llm/OllamaAgent')
const { normalizeThinkOption } = require('../src/llm/OllamaProvider')
const selectSkillTools = require('../src/llm/selectSkillTools')
const resolveDirectSkillCall = require('../src/llm/resolveDirectSkillCall')

const silentLog = () => {}

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
    model: 'qwen3:4b-instruct',
    think: false,
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
  const agent = new OllamaAgent({
    provider,
    skillRegistry: registry,
    log: silentLog
  })
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
  const initialUserMessage = provider.requests[0].messages
    .find((message) => message.role === 'user')
  assert.equal(initialUserMessage.content, 'How are you?')

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
    historyLimit: 4,
    log: silentLog
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
    maxToolCalls: 1,
    log: silentLog
  })

  const result = await agent.ask('jacob48317', 'Check health repeatedly')

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
    skillRegistry: createRegistry(),
    log: silentLog
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

test('selector sends no tools for ordinary conversation', () => {
  const definitions = [
    { name: 'get_status' },
    { name: 'follow_player' },
    { name: 'make_item' }
  ]

  assert.deepEqual(selectSkillTools('Say hello in one short sentence', definitions), [])
})

test('ordinary conversation uses a small context and minimal prompt', async () => {
  const provider = createProvider([
    { message: { role: 'assistant', content: 'The sky is blue.' } }
  ])
  const agent = new OllamaAgent({
    provider,
    skillRegistry: createRegistry(),
    log: silentLog
  })

  const result = await agent.ask('jacob48317', 'What color is the sky?')
  const request = provider.requests[0]
  const systemPrompt = request.messages[0].content

  assert.equal(result.message, 'The sky is blue.')
  assert.equal(request.numCtx, 2048)
  assert.equal(request.numPredict, 128)
  assert.deepEqual(request.tools, [])
  assert.match(systemPrompt, /ordinary conversation/i)
  assert.doesNotMatch(systemPrompt, /Use an available tool/)
})

test('Minecraft actions retain the tool-focused system prompt', async () => {
  const provider = createProvider([
    {
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [{
          function: {
            name: 'make_item',
            arguments: { item: 'stone_pickaxe', amount: 1 }
          }
        }]
      }
    },
    { message: { role: 'assistant', content: 'Done.' } }
  ])
  const definitions = [
    {
      name: 'make_item',
      description: 'Make an item.',
      inputSchema: { type: 'object', properties: {} }
    }
  ]
  const registry = {
    getToolDefinitions: () => definitions,
    execute: async () => ({ ok: true })
  }
  const agent = new OllamaAgent({
    provider,
    skillRegistry: registry,
    directSkillCalls: false,
    log: silentLog
  })

  await agent.ask('jacob48317', 'Make a stone pickaxe')

  const request = provider.requests[0]
  assert.equal(request.numCtx, undefined)
  assert.equal(request.numPredict, undefined)
  assert.equal(request.tools.length, 1)
  assert.match(request.messages[0].content, /sole authority on recipes/i)
  assert.match(request.messages[0].content, /call the best tool immediately/i)
})

test('an action retries once when the model writes prose instead of calling a tool', async () => {
  const provider = createProvider([
    { message: { role: 'assistant', content: 'I should check health.' } },
    {
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [{ function: { name: 'get_status', arguments: {} } }]
      }
    },
    { message: { role: 'assistant', content: 'You are healthy.' } }
  ])
  let executions = 0
  const agent = new OllamaAgent({
    provider,
    skillRegistry: createRegistry(async () => {
      executions += 1
      return { ok: true, skill: 'get_status', data: { health: 20 } }
    }),
    log: silentLog
  })

  const result = await agent.ask('jacob48317', 'Check your health')

  assert.equal(result.ok, true)
  assert.equal(executions, 1)
  assert.equal(provider.requests.length, 3)
  assert.ok(
    provider.requests[1].messages.some((message) => (
      /Call the single best available tool now/.test(message.content || '')
    ))
  )
})

test('an action cannot claim success without calling a Minecraft skill', async () => {
  const provider = createProvider([
    { message: { role: 'assistant', content: 'I will gather it.' } },
    { message: { role: 'assistant', content: 'Done.' } }
  ])
  const agent = new OllamaAgent({
    provider,
    skillRegistry: createRegistry(),
    log: silentLog
  })

  const result = await agent.ask('jacob48317', 'Check your health')

  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'NO_TOOL_CALL')
  assert.equal(result.tools.length, 0)
})

test('debug mode logs thinking separately from final content', async () => {
  const provider = createProvider([{
    message: {
      role: 'assistant',
      thinking: 'I should answer directly.',
      content: 'Blue.'
    }
  }])
  const logs = []
  const agent = new OllamaAgent({
    provider,
    skillRegistry: createRegistry(),
    debug: true,
    log: (message) => logs.push(message)
  })

  const result = await agent.ask('jacob48317', 'What color is the sky?')

  assert.equal(result.message, 'Blue.')
  assert.ok(logs.some((message) => message.includes('[llm:thinking]')))
  assert.ok(logs.some((message) => message.includes('[llm:content]')))
})

test('thinking defaults are model-aware', () => {
  assert.equal(normalizeThinkOption(undefined, 'qwen3:4b'), false)
  assert.equal(normalizeThinkOption(undefined, 'gpt-oss:20b-cloud'), 'low')
  assert.equal(normalizeThinkOption('medium', 'gpt-oss:20b-cloud'), 'medium')
  assert.equal(normalizeThinkOption(false, 'gpt-oss:20b-cloud'), 'low')
})

test('selector sends only tools relevant to the requested action', () => {
  const definitions = [
    { name: 'get_status' },
    { name: 'get_inventory' },
    { name: 'follow_player' },
    { name: 'craft_item' },
    { name: 'make_item' },
    { name: 'attack_hostile' }
  ]

  assert.deepEqual(
    selectSkillTools('Make one wooden pickaxe', definitions)
      .map((definition) => definition.name),
    ['make_item']
  )
})

test('selector makes gathering and come-to-me requests unambiguous', () => {
  const definitions = [
    { name: 'get_inventory' },
    { name: 'find_block' },
    { name: 'gather_block' },
    { name: 'follow_player' }
  ]

  assert.deepEqual(
    selectSkillTools('gather some dirt', definitions),
    [{ name: 'gather_block' }]
  )
  assert.deepEqual(
    selectSkillTools('come to me', definitions),
    [{ name: 'follow_player' }]
  )
})

test('simple action prompts resolve directly without waiting for Ollama', async () => {
  const provider = createProvider([])
  const calls = []
  const registry = {
    getToolDefinitions: () => [
      { name: 'follow_player' },
      { name: 'gather_block' }
    ],
    execute: async (name, input) => {
      calls.push({ name, input })
      return { ok: true, skill: name, data: true }
    }
  }
  const agent = new OllamaAgent({
    provider,
    skillRegistry: registry,
    log: silentLog
  })

  const follow = await agent.ask('jacob48317', 'come to me')
  const gather = await agent.ask('jacob48317', 'gather two dirt')

  assert.equal(follow.direct, true)
  assert.equal(gather.direct, true)
  assert.equal(provider.requests.length, 0)
  assert.deepEqual(calls, [
    {
      name: 'follow_player',
      input: { player: 'jacob48317' }
    },
    {
      name: 'gather_block',
      input: { block: 'dirt', amount: 2 }
    }
  ])
})

test('direct skill resolver handles coordinates and common amount wording', () => {
  assert.deepEqual(
    resolveDirectSkillCall('please gather some oak logs', 'jacob48317'),
    { name: 'gather_block', input: { block: 'oak logs', amount: 1 } }
  )
  assert.deepEqual(
    resolveDirectSkillCall('go to -10 64 22', 'jacob48317'),
    { name: 'go_to', input: { x: -10, y: 64, z: 22 } }
  )
  assert.deepEqual(
    resolveDirectSkillCall('follow Alex_123', 'jacob48317'),
    { name: 'follow_player', input: { player: 'Alex_123' } }
  )
})

test('nearby chest wording selects storage without an entity scan', () => {
  const definitions = [
    { name: 'get_inventory' },
    { name: 'scan_nearby' },
    { name: 'gather_block' },
    { name: 'store_item' }
  ]

  const selected = selectSkillTools(
    'Gather four logs and put them in the nearby chest',
    definitions
  ).map((definition) => definition.name)

  assert.deepEqual(selected, [
    'get_inventory',
    'gather_block',
    'store_item'
  ])
})

test('duplicate tool calls in one model round execute only once', async () => {
  const duplicateCalls = [
    { function: { name: 'get_status', arguments: {} } },
    { function: { name: 'get_status', arguments: {} } }
  ]
  const provider = createProvider([
    { message: { role: 'assistant', content: '', tool_calls: duplicateCalls } },
    { message: { role: 'assistant', content: 'You are healthy.' } }
  ])
  let executionCount = 0
  const agent = new OllamaAgent({
    provider,
    skillRegistry: createRegistry(async () => {
      executionCount += 1
      return { ok: true, skill: 'get_status', data: { health: 20 } }
    }),
    log: silentLog
  })

  const result = await agent.ask('jacob48317', 'Check your health')

  assert.equal(result.ok, true)
  assert.equal(executionCount, 1)
  assert.equal(result.tools.length, 2)
  assert.equal(result.tools[0].duplicate, false)
  assert.equal(result.tools[1].duplicate, true)
})

test('reasoning-style output is blocked from Minecraft chat', () => {
  const leakedReasoning = [
    'Okay, the user wants me to say hello.',
    'Let me check the tools available.',
    'The response should be short.'
  ].join(' ')

  assert.equal(
    finalizeReply(leakedReasoning, 'say hello', []),
    'Hello!'
  )
})

test('agent refuses a tool that was not selected for the request', async () => {
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
    { message: { role: 'assistant', content: 'Hello.' } }
  ])
  let executionCount = 0
  const registry = createRegistry(async () => {
    executionCount += 1
    return { ok: true }
  })
  const agent = new OllamaAgent({
    provider,
    skillRegistry: registry,
    log: silentLog
  })

  const result = await agent.ask('jacob48317', 'Say hello')

  assert.equal(result.ok, true)
  assert.equal(executionCount, 0)
  assert.equal(result.tools[0].result.error.code, 'TOOL_NOT_ALLOWED')
})

test('provider omits the tools field when no tools are selected', async () => {
  let requestBody
  const provider = new OllamaProvider({
    fetch: async (url, init) => {
      requestBody = JSON.parse(init.body)
      return new Response(JSON.stringify({
        message: { role: 'assistant', content: 'Hello.' },
        done: true
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
  })

  await provider.chat({
    messages: [{ role: 'user', content: 'Hello' }],
    tools: []
  })

  assert.equal(requestBody.options.num_ctx, 4096)
  assert.equal(Object.hasOwn(requestBody, 'tools'), false)
})
