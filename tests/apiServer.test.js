const test = require('node:test')
const assert = require('node:assert/strict')
const ChatBridge = require('../src/bridge/ChatBridge')
const TaskManager = require('../src/bridge/TaskManager')
const EarlApiServer = require('../src/api/EarlApiServer')

function createRuntime() {
  const skillRegistry = {
    list: () => [{
      name: 'get_status',
      description: 'status',
      inputSchema: { type: 'object' }
    }],
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
