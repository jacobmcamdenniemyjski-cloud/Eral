const test = require('node:test')
const assert = require('node:assert/strict')
const EventEmitter = require('node:events')
const { Vec3 } = require('vec3')
const minecraftData = require('minecraft-data')('1.21.1')
const DoorOpener = require('../src/movement/DoorOpener')
const followPlayer = require('../src/movement/followPlayer')
const traverseDoor = require('../src/movement/traverseDoor')
const smeltItem = require('../src/smelting/smeltItem')
const selectSkillTools = require('../src/llm/selectSkillTools')
const resolveDirectSkillCall = require('../src/llm/resolveDirectSkillCall')

test('smelting uses Mineflayer furnace operations and collects output', async () => {
  const furnaceBlock = { name: 'furnace', position: new Vec3(2, 0, 0) }
  const input = { name: 'raw_iron', type: 10, metadata: 0, count: 3 }
  const coal = { name: 'coal', type: 11, metadata: 0, count: 2 }
  const furnace = new EventEmitter()
  let output = null
  let inputPut = null
  let fuelPut = null
  let closed = false

  furnace.inputItem = () => null
  furnace.fuelItem = () => null
  furnace.outputItem = () => output
  furnace.putInput = async (...args) => { inputPut = args }
  furnace.putFuel = async (...args) => {
    fuelPut = args
    setImmediate(() => {
      output = { name: 'iron_ingot', count: 3 }
      furnace.emit('update')
    })
  }
  furnace.takeOutput = async () => {
    const taken = output
    output = null
    return taken
  }
  furnace.close = () => { closed = true }

  const bot = {
    registry: {
      blocksByName: { furnace: { id: 61 } }
    },
    inventory: { items: () => [input, coal] },
    findBlock: () => furnaceBlock,
    blockAt: () => furnaceBlock,
    pathfinder: { goto: async () => {} },
    openFurnace: async () => furnace,
    chat: () => {}
  }

  const result = await smeltItem(bot, 'raw_iron', 3)

  assert.deepEqual(inputPut, [10, 0, 3])
  assert.deepEqual(fuelPut, [11, 0, 1])
  assert.deepEqual(result, {
    input: 'raw_iron',
    added: 3,
    existingInput: 0,
    output: 'iron_ingot',
    count: 3,
    fuel: 'coal',
    fuelAdded: 1,
    collectedBefore: null
  })
  assert.equal(closed, true)
})

test('smelting adds matching input, reuses fuel, and collects old output', async () => {
  const furnaceBlock = { name: 'furnace', position: new Vec3(2, 0, 0) }
  const input = {
    name: 'raw_iron', type: 10, metadata: 0, count: 3, stackSize: 64
  }
  let inputSlot = {
    name: 'raw_iron', type: 10, metadata: 0, count: 2, stackSize: 64
  }
  const fuelSlot = { name: 'coal', type: 11, metadata: 0, count: 1 }
  let output = { name: 'iron_ingot', count: 1 }
  const furnace = new EventEmitter()
  let inputPut = null
  let fuelPut = null

  furnace.fuelSeconds = 0
  furnace.inputItem = () => inputSlot
  furnace.fuelItem = () => fuelSlot
  furnace.outputItem = () => output
  furnace.putInput = async (...args) => {
    inputPut = args
    inputSlot = { ...inputSlot, count: 5 }
    setImmediate(() => {
      inputSlot = null
      output = { name: 'iron_ingot', count: 5 }
      furnace.emit('update')
    })
  }
  furnace.putFuel = async (...args) => { fuelPut = args }
  furnace.takeOutput = async () => {
    const taken = output
    output = null
    return taken
  }
  furnace.close = () => {}

  const bot = {
    registry: { blocksByName: { furnace: { id: 61 } } },
    inventory: { items: () => [input] },
    findBlock: () => furnaceBlock,
    blockAt: () => furnaceBlock,
    pathfinder: { goto: async () => {} },
    openFurnace: async () => furnace,
    chat: () => {}
  }

  const result = await smeltItem(bot, 'raw_iron', 3)

  assert.deepEqual(inputPut, [10, 0, 3])
  assert.equal(fuelPut, null)
  assert.equal(result.existingInput, 2)
  assert.equal(result.added, 3)
  assert.equal(result.count, 5)
  assert.equal(result.fuelAdded, 0)
  assert.deepEqual(result.collectedBefore, { name: 'iron_ingot', count: 1 })
})

test('smelting refuses to mix a different item into an occupied furnace', async () => {
  const furnaceBlock = { name: 'furnace', position: new Vec3(2, 0, 0) }
  let closed = false
  const furnace = {
    inputItem: () => ({ name: 'raw_gold', metadata: 0, count: 2 }),
    fuelItem: () => ({ name: 'coal', count: 1 }),
    outputItem: () => null,
    close: () => { closed = true }
  }
  const bot = {
    registry: { blocksByName: { furnace: { id: 61 } } },
    inventory: {
      items: () => [{ name: 'raw_iron', type: 10, metadata: 0, count: 3 }]
    },
    findBlock: () => furnaceBlock,
    blockAt: () => furnaceBlock,
    pathfinder: { goto: async () => {} },
    openFurnace: async () => furnace,
    chat: () => {}
  }

  await assert.rejects(
    smeltItem(bot, 'raw_iron', 3),
    /already contains raw_gold/
  )
  assert.equal(closed, true)
})

test('furnace status and output collection use existing Mineflayer slots', async () => {
  const furnaceBlock = { name: 'furnace', position: new Vec3(2, 0, 0) }
  let output = { name: 'iron_ingot', count: 4 }
  let closed = 0
  const chats = []
  const furnace = {
    progress: 0.5,
    fuelSeconds: 42,
    inputItem: () => ({ name: 'raw_iron', count: 3 }),
    fuelItem: () => ({ name: 'coal', count: 1 }),
    outputItem: () => output,
    takeOutput: async () => {
      const taken = output
      output = null
      return taken
    },
    close: () => { closed += 1 }
  }
  const bot = {
    registry: { blocksByName: { furnace: { id: 61 } } },
    findBlock: () => furnaceBlock,
    blockAt: () => furnaceBlock,
    pathfinder: { goto: async () => {} },
    openFurnace: async () => furnace,
    chat: (message) => chats.push(message)
  }

  const status = await smeltItem.getFurnaceStatus(bot)
  const collected = await smeltItem.collectFurnaceOutput(bot)

  assert.deepEqual(status.output, { name: 'iron_ingot', count: 4 })
  assert.equal(status.progressPercent, 50)
  assert.deepEqual(collected.collected, { name: 'iron_ingot', count: 4 })
  assert.equal(output, null)
  assert.equal(closed, 2)
  assert.ok(chats.some((message) => /progress 50%/i.test(message)))
})

test('fuel selection supports explicit wood and rejects non-fuel items', () => {
  const bot = {
    inventory: {
      items: () => [
        { name: 'oak_planks', count: 2 },
        { name: 'dirt', count: 64 }
      ]
    }
  }

  const fuel = smeltItem.selectFuel(bot, 3, 'oak_planks')
  assert.equal(fuel.count, 2)
  assert.equal(smeltItem.fuelCapacity('dirt'), 0)
})

test('door opener clicks a horizontal face and ignores iron doors', async () => {
  const bot = new EventEmitter()
  bot.entity = { position: new Vec3(0, 0, 0) }

  let open = false
  const oakDoor = {
    name: 'oak_door',
    position: new Vec3(1, 0, 0),
    getProperties: () => ({ open })
  }
  const ironDoor = {
    name: 'iron_door',
    position: new Vec3(0, 0, 1),
    getProperties: () => ({ open: false })
  }

  bot.blockAt = (position) => {
    if (position.equals(oakDoor.position)) return oakDoor
    if (position.equals(ironDoor.position)) return ironDoor
    return { name: 'air', position, getProperties: () => ({}) }
  }

  let activated = null
  let replans = 0
  bot.activateBlock = async (block, face) => {
    activated = { block, face }
    open = true
  }

  const opener = new DoorOpener(bot, {
    radius: 1,
    onOpened: async () => { replans += 1 }
  })
  opener.start()
  const result = await opener.tick()
  opener.stop()

  assert.equal(result, true)
  assert.equal(activated.block.name, 'oak_door')
  assert.equal(activated.face.y, 0)
  assert.equal(Math.abs(activated.face.x) + Math.abs(activated.face.z), 1)
  assert.equal(bot.listenerCount('physicsTick'), 0)
  assert.equal(DoorOpener.isHandOpenable(ironDoor), false)
  assert.equal(replans, 1)
})

test('following plans through doors without allowing wall digging', async () => {
  const bot = new EventEmitter()
  const player = { position: new Vec3(8, 0, 0) }
  const goals = []
  let movements = null

  bot.entity = { position: new Vec3(0, 0, 0) }
  bot.players = { jacob48317: { entity: player } }
  bot.registry = minecraftData
  bot.inventory = { items: () => [] }
  bot.pathfinder = {
    goal: null,
    setMovements(value) { movements = value },
    setGoal(goal, dynamic) {
      this.goal = goal
      goals.push({ goal, dynamic })
    }
  }
  bot.chat = () => {}

  await followPlayer(bot, 'jacob48317')
  assert.equal(goals.length, 1)
  assert.equal(movements.canOpenDoors, true)
  assert.equal(movements.canDig, false)
})

test('door opener retries when the server does not confirm the first click', async () => {
  const bot = new EventEmitter()
  bot.entity = { position: new Vec3(0, 64, 0) }
  let open = false
  let attempts = 0
  const door = {
    name: 'oak_door',
    position: new Vec3(1, 64, 0),
    getProperties: () => ({ half: 'lower', facing: 'east', open })
  }
  bot.blockAt = () => door
  bot.activateBlock = async () => {
    attempts += 1
    if (attempts === 2) open = true
  }

  const opener = new DoorOpener(bot, { stateTimeoutMs: 5 })
  assert.equal(await opener.setOpen(door, true), true)
  assert.equal(attempts, 2)
})

test('door traversal reaches the opposite side and can close behind Earl', async () => {
  const bot = new EventEmitter()
  let open = false
  const lower = {
    name: 'oak_door',
    type: 10,
    position: new Vec3(0, 64, 0),
    getProperties: () => ({ half: 'lower', facing: 'east', open })
  }
  const upper = {
    name: 'oak_door',
    type: 10,
    position: new Vec3(0, 65, 0),
    getProperties: () => ({ half: 'upper', facing: 'east', open })
  }
  bot.entity = { position: new Vec3(-1, 64, 0) }
  bot.registry = {
    ...minecraftData,
    blocksByName: {
      ...minecraftData.blocksByName,
      oak_door: { ...minecraftData.blocksByName.oak_door, id: 10 }
    }
  }
  bot.inventory = { items: () => [] }
  bot.findBlocks = () => [lower.position, upper.position]
  bot.blockAt = (position) => position.y === 65 ? upper : lower
  bot.activateBlock = async () => { open = !open }
  bot.pathfinder = {
    goal: null,
    setMovements() {},
    setGoal() {},
    async goto(goal) {
      bot.entity.position = new Vec3(goal.x, goal.y, goal.z)
    }
  }

  const result = await traverseDoor(bot, {
    maxDistance: 8,
    closeBehind: true,
    returnThrough: true
  })

  assert.equal(result.crossed, true)
  assert.equal(result.closedBehind, true)
  assert.equal(result.crossings, 2)
  assert.equal(bot.entity.position.x, -1)
  assert.equal(open, false)
})

test('door traversal has a bounded direct-walk fallback for an open doorway', async () => {
  const destination = new Vec3(1, 64, 0)
  let moving = false
  const bot = {
    entity: { position: new Vec3(-1, 64, 0) },
    async lookAt() {},
    setControlState(name, value) {
      if (name === 'forward') moving = value
    },
    clearControlStates() { moving = false },
    async waitForTicks() {
      if (moving) bot.entity.position = bot.entity.position.offset(0.5, 0, 0)
    }
  }

  const crossed = await traverseDoor.walkDirectlyThrough(bot, destination)
  assert.equal(crossed, true)
  assert.equal(moving, false)
  assert.ok(bot.entity.position.distanceTo(destination) <= 1.25)
})

test('LLM selects one focused furnace tool for each request', () => {
  const definitions = [
    { name: 'smelt_item' },
    { name: 'get_inventory' },
    { name: 'make_item' },
    { name: 'get_furnace_status' },
    { name: 'collect_furnace_output' },
    { name: 'gather_block' }
  ]

  assert.deepEqual(
    selectSkillTools('smelt three raw iron in the furnace', definitions),
    [{ name: 'smelt_item' }]
  )
  assert.deepEqual(
    selectSkillTools('what is in the furnace', definitions),
    [{ name: 'get_furnace_status' }]
  )
  assert.deepEqual(
    selectSkillTools('collect the furnace output', definitions),
    [{ name: 'collect_furnace_output' }]
  )
})

test('simple furnace requests use the deterministic action fast path', () => {
  assert.deepEqual(
    resolveDirectSkillCall('furnace status', 'jacob48317'),
    { name: 'get_furnace_status', input: {} }
  )
  assert.deepEqual(
    resolveDirectSkillCall('collect the furnace output', 'jacob48317'),
    { name: 'collect_furnace_output', input: {} }
  )
  assert.deepEqual(
    resolveDirectSkillCall('smelt 3 raw iron with coal', 'jacob48317'),
    {
      name: 'smelt_item',
      input: { item: 'raw iron', amount: 3, fuel: 'coal' }
    }
  )
})
