const test = require('node:test')
const assert = require('node:assert/strict')
const ChatBridge = require('../src/bridge/ChatBridge')
const TaskManager = require('../src/bridge/TaskManager')
const EarlApiServer = require('../src/api/EarlApiServer')
const LearnedProcedureStore = require('../src/learning/LearnedProcedureStore')

function createRuntime() {
  const skillRegistry = {
    list: () => [{
      name: 'get_status',
      description: 'status',
      inputSchema: { type: 'object' }
    }],
    validateInput: (name) => name === 'get_status'
      ? { ok: true, skill: name }
      : {
          ok: false,
          skill: name,
          error: { code: 'UNKNOWN_SKILL', message: `Unknown skill: ${name}` }
        },
    execute: async (name, input) => {
      if (name === 'unknown') {
        return {
          ok: false,
          skill: name,
          error: { code: 'UNKNOWN_SKILL', message: 'unknown' }
        }
      }
      return { ok: true, skill: name, data: { name, input } }
    }
  }

  return {
    skillRegistry,
    cancelActiveWork: async () => {}
  }
}

test('body API authenticates tool access and executes skills', async () => {
  const chats = []
  const bot = {
    entity: {},
    username: 'earl',
    version: '1.21.11',
    chat: (message) => chats.push(message)
  }
  const runtime = createRuntime()
  const chatBridge = new ChatBridge()
  const taskManager = new TaskManager({
    skillRegistry: runtime.skillRegistry,
    cancelActiveWork: runtime.cancelActiveWork
  })
  const server = new EarlApiServer({
    bot,
    runtime,
    chatBridge,
    taskManager,
    deathTracker: null,
    host: '127.0.0.1',
    port: 0,
    token: 'secret',
    brainMode: 'hermes'
  })

  try {
    const address = await server.start()
    const base = `http://127.0.0.1:${address.port}`

    const health = await (await fetch(`${base}/health`)).json()
    assert.equal(health.data.connected, true)
    assert.equal(health.data.brainMode, 'hermes')

    const unauthorized = await fetch(`${base}/skills`)
    assert.equal(unauthorized.status, 401)

    const executed = await (await fetch(`${base}/execute`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer secret',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        skill: 'get_status',
        input: {}
      })
    })).json()
    assert.equal(executed.ok, true)
    assert.equal(executed.data.name, 'get_status')

    const cancelled = await (await fetch(`${base}/cancel`, {
      method: 'POST',
      headers: { authorization: 'Bearer secret' }
    })).json()
    assert.equal(cancelled.ok, true)
    assert.equal(cancelled.data.stopped, true)

    const chatted = await (await fetch(`${base}/action/chat`, {
      method: 'POST',
      headers: {
        'x-earl-token': 'secret',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ message: 'hello Jacob' })
    })).json()
    assert.equal(chatted.ok, true)
    assert.deepEqual(chats, ['hello Jacob'])
  } finally {
    await server.stop()
  }
})

test('body API starts and reports background tasks', async () => {
  const bot = { entity: {}, username: 'earl', chat: () => {} }
  const runtime = createRuntime()
  const chatBridge = new ChatBridge()
  const taskManager = new TaskManager({
    skillRegistry: runtime.skillRegistry,
    cancelActiveWork: runtime.cancelActiveWork
  })
  const server = new EarlApiServer({
    bot,
    runtime,
    chatBridge,
    taskManager,
    port: 0
  })

  try {
    const address = await server.start()
    const base = `http://127.0.0.1:${address.port}`
    const response = await fetch(`${base}/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        skill: 'get_status',
        input: {},
        background: true
      })
    })
    const started = await response.json()

    assert.equal(response.status, 202)
    assert.equal(started.data.skill, 'get_status')
    await new Promise((resolve) => setImmediate(resolve))

    const tasks = await (await fetch(`${base}/tasks`)).json()
    assert.equal(tasks.data.history[0].status, 'completed')
  } finally {
    await server.stop()
  }
})

test('health does not claim a stale entity is still connected', async () => {
  const bot = {
    entity: {},
    username: 'earl',
    _client: { socket: { destroyed: true } },
    chat: () => {}
  }
  const runtime = createRuntime()
  runtime.connectionState = {
    connected: false,
    spawned: false,
    lastEvent: 'end',
    lastDisconnect: { reason: 'Timed out' }
  }
  const chatBridge = new ChatBridge()
  const taskManager = new TaskManager({
    skillRegistry: runtime.skillRegistry,
    cancelActiveWork: runtime.cancelActiveWork
  })
  const server = new EarlApiServer({
    bot,
    runtime,
    chatBridge,
    taskManager,
    port: 0
  })

  try {
    const address = await server.start()
    const health = await (await fetch(
      `http://127.0.0.1:${address.port}/health`
    )).json()
    assert.equal(health.data.connected, false)
    assert.equal(health.data.spawned, false)
    assert.equal(health.data.socketConnected, false)
  } finally {
    await server.stop()
  }
})


test('body API long-polls until a Minecraft command arrives', async () => {
  const bot = { entity: {}, username: 'earl', chat: () => {} }
  const runtime = createRuntime()
  const chatBridge = new ChatBridge()
  const taskManager = new TaskManager({
    skillRegistry: runtime.skillRegistry,
    cancelActiveWork: runtime.cancelActiveWork
  })
  const server = new EarlApiServer({
    bot,
    runtime,
    chatBridge,
    taskManager,
    port: 0
  })

  try {
    const address = await server.start()
    const base = `http://127.0.0.1:${address.port}`
    const waiting = fetch(`${base}/commands/wait?timeout=1`)
      .then((response) => response.json())

    setTimeout(() => {
      chatBridge.enqueue('jacob', 'make a stone pickaxe')
    }, 25)

    const response = await waiting
    assert.equal(response.ok, true)
    assert.equal(response.data[0].command, 'make a stone pickaxe')
  } finally {
    await server.stop()
  }
})


test('body API stages, approves, and executes validated procedures', async () => {
  const bot = { entity: {}, username: 'earl', chat: () => {} }
  const runtime = createRuntime()
  const chatBridge = new ChatBridge()
  const taskManager = new TaskManager({
    skillRegistry: runtime.skillRegistry,
    cancelActiveWork: runtime.cancelActiveWork
  })
  const procedureStore = new LearnedProcedureStore({
    skillRegistry: runtime.skillRegistry
  })
  const server = new EarlApiServer({
    bot,
    runtime,
    chatBridge,
    taskManager,
    procedureStore,
    port: 0
  })

  try {
    const address = await server.start()
    const base = `http://127.0.0.1:${address.port}`
    const definition = {
      name: 'check_status',
      description: 'Check Earl status.',
      steps: [{ skill: 'get_status', input: {} }]
    }

    const stagedResponse = await fetch(`${base}/procedures/stage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(definition)
    })
    const staged = await stagedResponse.json()
    assert.equal(stagedResponse.status, 201)
    assert.equal(staged.data.status, 'pending')

    const blocked = await fetch(
      `${base}/procedures/${staged.data.id}/execute`,
      { method: 'POST' }
    )
    assert.equal(blocked.status, 403)

    const approved = await (await fetch(
      `${base}/procedures/${staged.data.id}/approve`,
      { method: 'POST' }
    )).json()
    assert.equal(approved.data.status, 'approved')

    const executed = await (await fetch(
      `${base}/procedures/${staged.data.id}/execute`,
      { method: 'POST' }
    )).json()
    assert.equal(executed.ok, true)
    assert.equal(executed.data.completedSteps, 1)
  } finally {
    await server.stop()
  }
})

test('body API exposes and controls autonomous intentions', async () => {
  const bot = { entity: {}, username: 'earl', chat: () => {} }
  const runtime = createRuntime()
  const chatBridge = new ChatBridge()
  const taskManager = new TaskManager({
    skillRegistry: runtime.skillRegistry,
    cancelActiveWork: runtime.cancelActiveWork
  })
  let enabled = false
  const autonomyController = {
    getStatus: () => ({ enabled, current: null }),
    setEnabled: (value) => {
      enabled = value
      return { enabled, current: null }
    },
    tick: async () => ({ enabled, current: { title: 'inspect home' } }),
    observe: async () => ({ health: 20 }),
    generateCandidates: () => [{ title: 'inspect home', score: 42 }],
    interrupt: async () => ({ enabled, current: null }),
    resume: async () => ({ enabled, current: null })
  }
  const server = new EarlApiServer({
    bot,
    runtime,
    chatBridge,
    taskManager,
    autonomyController,
    port: 0
  })

  try {
    const address = await server.start()
    const base = `http://127.0.0.1:${address.port}`
    const enabledResult = await (await fetch(`${base}/autonomy/enable`, {
      method: 'POST'
    })).json()
    assert.equal(enabledResult.data.enabled, true)

    const status = await (await fetch(`${base}/autonomy`)).json()
    assert.equal(status.data.enabled, true)

    const candidates = await (await fetch(
      `${base}/autonomy/candidates`
    )).json()
    assert.equal(candidates.data[0].title, 'inspect home')

    const ticked = await (await fetch(`${base}/autonomy/tick`, {
      method: 'POST'
    })).json()
    assert.equal(ticked.data.current.title, 'inspect home')
  } finally {
    await server.stop()
  }
})
