const test = require('node:test')
const assert = require('node:assert/strict')
const EventEmitter = require('node:events')
const { Vec3 } = require('vec3')
const minecraftData = require('minecraft-data')('1.21.1')
const DoorOpener = require('../src/movement/DoorOpener')
const followPlayer = require('../src/movement/followPlayer')
const smeltItem = require('../src/smelting/smeltItem')
const selectSkillTools = require('../src/llm/selectSkillTools')

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
    output: 'iron_ingot',
    count: 3,
    fuel: 'coal',
    fuelUsed: 1
  })
  assert.equal(closed, true)
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

test('LLM selects only the smelting tools for a furnace request', () => {
  const definitions = [
    { name: 'smelt_item' },
    { name: 'get_inventory' },
    { name: 'make_item' }
  ]

  assert.deepEqual(
    selectSkillTools('smelt three raw iron in the furnace', definitions),
    [{ name: 'smelt_item' }, { name: 'get_inventory' }]
  )
})
