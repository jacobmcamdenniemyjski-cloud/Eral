const test = require('node:test')
const assert = require('node:assert/strict')
const EventEmitter = require('node:events')
const { Vec3 } = require('vec3')
const minecraftData = require('minecraft-data')('1.21.1')
const fillBucket = require('../src/world/fillBucket')
const storeItem = require('../src/inventory/storeItem')
const traverseDoor = require('../src/movement/traverseDoor')
const { placeBlockAt } = require('../src/building/placeBlock')

test('fill bucket verifies the inventory exchange at source water', async () => {
  const sourcePosition = new Vec3(3, 63, 0)
  const source = {
    name: 'water', position: sourcePosition, metadata: 0, boundingBox: 'empty',
    getProperties: () => ({ level: 0 })
  }
  const inventory = [{ name: 'bucket', type: 1, count: 1 }]
  const bot = {
    entity: { position: new Vec3(0, 64, 0) },
    registry: {
      ...minecraftData,
      blocksByName: { ...minecraftData.blocksByName, water: { id: 9 } },
      itemsByName: { ...minecraftData.itemsByName, bucket: { id: 1 }, water_bucket: { id: 2 } }
    },
    inventory: { items: () => inventory },
    findBlocks: () => [sourcePosition],
    blockAt: (position) => position.equals(sourcePosition)
      ? source
      : position.y === sourcePosition.y
        ? { name: 'dirt', boundingBox: 'block', position }
        : { name: 'air', boundingBox: 'empty', position },
    pathfinder: {
      setMovements() {},
      async goto(goal) { bot.entity.position = new Vec3(goal.x, goal.y, goal.z) }
    },
    async equip(item) { bot.heldItem = item },
    async activateBlock() {
      inventory[0].count = 0
      inventory.push({ name: 'water_bucket', type: 2, count: 1 })
    },
    async waitForTicks() {}
  }
  const result = await fillBucket(bot)
  assert.equal(result.status, 'completed')
  assert.equal(result.waterBucketAfter, 1)
})

test('fill bucket refuses sealed underground water without moving', async () => {
  const sourcePosition = new Vec3(3, 50, 0)
  const source = {
    name: 'water', position: sourcePosition, metadata: 0, boundingBox: 'empty',
    getProperties: () => ({ level: 0 })
  }
  let moved = false
  const bot = {
    entity: { position: new Vec3(0, 64, 0) },
    registry: {
      blocksByName: { water: { id: 9 } },
      itemsByName: { bucket: { id: 1 }, water_bucket: { id: 2 } }
    },
    inventory: { items: () => [{ name: 'bucket', type: 1, count: 1 }] },
    findBlocks: () => [sourcePosition],
    blockAt: (position) => position.equals(sourcePosition)
      ? source
      : { name: 'stone', boundingBox: 'block', position },
    pathfinder: { async goto() { moved = true } }
  }
  await assert.rejects(fillBucket(bot), /exposed source water/)
  assert.equal(moved, false)
})

test('storage skips an unreachable container and uses the next one', async () => {
  const first = { name: 'chest', position: new Vec3(1, 64, 0) }
  const second = { name: 'barrel', position: new Vec3(3, 64, 0) }
  let opens = 0
  let deposited = 0
  const bot = {
    entity: { position: new Vec3(0, 64, 0) },
    registry: { blocksByName: { chest: { id: 1 }, barrel: { id: 2 } } },
    inventory: { items: () => [{ name: 'dirt', type: 3, count: 8 }] },
    findBlocks: () => [first.position, second.position],
    blockAt: (position) => position.x === 1 ? first : second,
    pathfinder: { async goto() {} },
    async openContainer(block) {
      opens += 1
      if (block === first) throw new Error('windowOpen timed out')
      return {
        async deposit(type, metadata, amount) { deposited = amount },
        close() {}
      }
    },
    chat() {}
  }
  const result = await storeItem(bot, 'dirt', 4)
  assert.equal(result.status, 'completed')
  assert.equal(opens, 2)
  assert.equal(deposited, 4)
  assert.equal(result.container.x, 3)
})

test('door traversal rejects a near-door result that never changed sides', async () => {
  const bot = new EventEmitter()
  let open = false
  const door = {
    name: 'oak_door', type: 10, position: new Vec3(0, 64, 0),
    getProperties: () => ({ half: 'lower', facing: 'east', open })
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
  bot.findBlocks = () => [door.position]
  bot.blockAt = () => door
  bot.activateBlock = async () => { open = true }
  bot.pathfinder = {
    setMovements() {}, setGoal() {},
    async goto() { bot.entity.position = new Vec3(-0.1, 64, 0) }
  }
  await assert.rejects(traverseDoor(bot, { maxDistance: 8 }), /did not pass through/)
})

test('placement collects a dropped item occupying its target before retrying', async () => {
  const target = new Vec3(1, 64, 0)
  const support = new Vec3(1, 63, 0)
  const dropped = { id: 9, name: 'item', displayName: 'Item', position: target.offset(0.5, 0, 0.5) }
  let placed = false
  const item = { name: 'oak_planks', type: 5, count: 1 }
  const bot = {
    entity: { id: 1, position: new Vec3(0, 64, 0), eyeHeight: 1.62 },
    entities: { dropped }, heldItem: null,
    game: { gameMode: 'survival' },
    registry: {
      blocksByName: { oak_planks: { id: 5 } },
      itemsByName: { oak_planks: { id: 5 } }
    },
    inventory: { items: () => [item] },
    blockAt(position) {
      if (position.equals(target)) return { name: placed ? 'oak_planks' : 'air', boundingBox: placed ? 'block' : 'empty', position }
      if (position.equals(support)) return { name: 'dirt', boundingBox: 'block', position }
      return { name: 'air', boundingBox: 'empty', position }
    },
    pathfinder: { async goto() { delete bot.entities.dropped } },
    async waitForTicks() {},
    async equip(value) { bot.heldItem = value },
    async placeBlock() { placed = true; item.count = 0 }
  }
  const result = await placeBlockAt(bot, 'oak_planks', target)
  assert.equal(result.status, 'completed')
  assert.equal(placed, true)
})

test('bucket wording routes directly to the verified fill skill', () => {
  const resolveDirectSkillCall = require('../src/llm/resolveDirectSkillCall')
  assert.deepEqual(resolveDirectSkillCall('fill the bucket with water', 'Jacob'), {
    name: 'fill_bucket', input: { maxDistance: 32 }
  })
})
