const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const ChatBridge = require('../src/bridge/ChatBridge')
const AutonomyController = require('../src/autonomy/AutonomyController')

function observation(overrides = {}) {
  return {
    connected: true,
    health: 20,
    food: 20,
    timeOfDay: 6000,
    inventory: [
      { name: 'oak_log', count: 16 },
      { name: 'cobblestone', count: 32 },
      { name: 'bread', count: 8 }
    ],
    inventorySlots: 3,
    players: [],
    locations: [{ name: 'home', x: 0, y: 64, z: 0 }],
    fighting: null,
    physicalTask: null,
    commandQueueBusy: false,
    ...overrides
  }
}

function createController(options = {}) {
  const chatBridge = options.chatBridge || new ChatBridge()
  const bot = {
    username: 'earl',
    entity: {},
    health: 20,
    food: 20,
    players: {},
    inventory: { items: () => [] },
    time: { timeOfDay: 6000 }
  }
  const controller = new AutonomyController({
    bot,
    chatBridge,
    enabled: true,
    random: () => 0,
    minimumIntentIntervalMs: 0,
    observe: async () => observation(options.observation),
    taskManager: options.taskManager,
    cancelActiveWork: options.cancelActiveWork,
    filePath: options.filePath
  })
  return { controller, chatBridge }
}

test('autonomy evaluates needs and queues one high-level intention', async () => {
  const { controller, chatBridge } = createController({
    observation: {
      food: 8,
      inventory: [],
      locations: [],
      inventorySlots: 0
    }
  })

  const status = await controller.tick()
  const queued = chatBridge.getCommands({ status: 'pending' })

  assert.equal(status.current.title, 'secure a reliable food supply')
  assert.equal(status.current.drive, 'food_security')
  assert.equal(queued.length, 1)
  assert.equal(queued[0].source, 'autonomy')
  assert.equal(queued[0].intentionId, status.current.id)
  assert.match(queued[0].command, /intention, not a fixed command list/i)
})

test('urgent reflex pauses active intention and resumes the same intention', async () => {
  let cancelledTasks = 0
  let cancelledWork = 0
  let activeTask = { id: 9, requestedBy: 'autonomy' }
  const taskManager = {
    getCurrent: () => activeTask,
    cancelCurrent: async () => {
      cancelledTasks += 1
      activeTask = null
    }
  }
  const { controller, chatBridge } = createController({
    taskManager,
    cancelActiveWork: async () => { cancelledWork += 1 }
  })

  await controller.tick()
  const intentionId = controller.getStatus().current.id
  const commandId = controller.getStatus().current.commandId
  chatBridge.claimCommand(commandId)

  const paused = await controller.interrupt('nearby zombie')
  assert.equal(paused.current.id, intentionId)
  assert.equal(paused.current.status, 'paused')
  assert.equal(chatBridge.findCommand(commandId).status, 'paused')
  assert.equal(cancelledTasks, 1)
  assert.equal(cancelledWork, 1)

  const resumed = await controller.resume('zombie defeated')
  assert.equal(resumed.current.id, intentionId)
  assert.equal(resumed.current.status, 'active')
  assert.equal(chatBridge.findCommand(commandId).status, 'pending')
  assert.match(chatBridge.findCommand(commandId).command, /Resume autonomous intention/)
})

test('observed low-health interruption clears when health recovers', async () => {
  let currentObservation = observation()
  const chatBridge = new ChatBridge()
  const controller = new AutonomyController({
    bot: { username: 'earl', entity: {} },
    chatBridge,
    enabled: true,
    random: () => 0,
    minimumIntentIntervalMs: 0,
    observe: async () => currentObservation
  })

  await controller.tick()
  const intentionId = controller.getStatus().current.id
  currentObservation = observation({ health: 4 })
  await controller.tick()
  assert.equal(controller.getStatus().current.status, 'paused')

  currentObservation = observation({ health: 12 })
  await controller.tick()
  assert.equal(controller.getStatus().current.id, intentionId)
  assert.equal(controller.getStatus().current.status, 'active')
  assert.equal(controller.getStatus().urgentReason, null)
})

test('player requests outrank autonomy and prevent a new intention', async () => {
  const chatBridge = new ChatBridge()
  chatBridge.enqueue('Jacob', 'follow me', { source: 'minecraft_ask' })
  const { controller } = createController({ chatBridge })

  const status = await controller.tick()
  const commands = chatBridge.getCommands({ status: 'pending' })

  assert.equal(status.current, null)
  assert.equal(commands[0].from, 'Jacob')
})

test('completed intentions become compact persistent history', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'earl-autonomy-'))
  const filePath = path.join(directory, 'autonomy.json')
  try {
    const { controller, chatBridge } = createController({ filePath })
    await controller.tick()
    const current = controller.getStatus().current
    chatBridge.completeCommand(current.commandId, 'home lighting improved')
    await controller.tick()

    const restarted = createController({ filePath }).controller
    const status = restarted.getStatus()
    assert.equal(status.current, null)
    assert.equal(status.recentHistory[0].status, 'completed')
    assert.equal(status.recentHistory[0].outcome, 'home lighting improved')
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('healthy Earl may choose a nonessential project instead of busywork', async () => {
  const { controller } = createController()
  const snapshot = observation()
  const candidates = controller.generateCandidates(snapshot)

  assert.ok(candidates.some((candidate) => candidate.drive === 'home_quality'))
  assert.ok(candidates.some((candidate) => candidate.drive === 'exploration'))
  assert.ok(candidates.some((candidate) => (
    candidate.drive === 'comfort' && candidate.title.includes('rest')
  )))
})
