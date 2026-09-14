const test = require('node:test')
const assert = require('node:assert/strict')
const EventEmitter = require('node:events')
const { Vec3 } = require('vec3')
const minecraftData = require('minecraft-data')('1.21.1')
const DoorOpener = require('../src/movement/DoorOpener')
const followPlayer = require('../src/movement/followPlayer')
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

test('following recalculates its route after a door opens', async () => {
  const bot = new EventEmitter()
  const player = { position: new Vec3(8, 0, 0) }
  const goals = []

  bot.entity = { position: new Vec3(0, 0, 0) }
  bot.players = { jacob48317: { entity: player } }
  bot.registry = minecraftData
  bot.inventory = { items: () => [] }
  bot.pathfinder = {
    goal: null,
    setMovements() {},
    setGoal(goal, dynamic) {
      this.goal = goal
      goals.push({ goal, dynamic })
    }
  }
  bot.chat = () => {}

  await followPlayer(bot, 'jacob48317')
  await bot.earl.doorOpener.onOpened()
  bot.earl.doorOpener.stop()

  assert.equal(goals.length, 2)
  assert.equal(goals[1].goal, goals[0].goal)
  assert.equal(goals[1].dynamic, true)
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
