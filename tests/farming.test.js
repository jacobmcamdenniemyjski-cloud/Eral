const test = require('node:test')
const assert = require('node:assert/strict')
const { Vec3 } = require('vec3')
const farmCrops = require('../src/farming/farmCrops')
const getFarmStatus = require('../src/farming/getFarmStatus')
const {
  getCropAge,
  resolveCropName
} = require('../src/farming/crops')

const BLOCKS = {
  air: { id: 0 },
  wheat: { id: 206 },
  carrots: { id: 439 },
  potatoes: { id: 440 },
  beetroots: { id: 663 },
  farmland: { id: 207 },
  chest: { id: 54 }
}

function key(position) {
  return `${position.x},${position.y},${position.z}`
}

function createBlock(name, position, age = null) {
  return {
    name,
    type: BLOCKS[name].id,
    position,
    metadata: age,
    boundingBox: name === 'air' ? 'empty' : 'block',
    getProperties: age === null ? () => ({}) : () => ({ age })
  }
}

function createBot(options = {}) {
  const chats = []
  const world = new Map()
  const inventory = options.inventory || [
    { name: 'wheat_seeds', type: 951, count: 16 }
  ]
  const mature = new Vec3(2, 65, 0)
  const growing = new Vec3(3, 65, 0)
  const empty = new Vec3(4, 65, 0)

  world.set(key(mature), createBlock('wheat', mature, 7))
  world.set(key(mature.offset(0, -1, 0)), createBlock(
    'farmland',
    mature.offset(0, -1, 0)
  ))
  world.set(key(growing), createBlock('wheat', growing, 3))
  world.set(key(growing.offset(0, -1, 0)), createBlock(
    'farmland',
    growing.offset(0, -1, 0)
  ))
  world.set(key(empty.offset(0, -1, 0)), createBlock(
    'farmland',
    empty.offset(0, -1, 0)
  ))

  const additionalMature = Array.from(
    { length: options.additionalMature || 0 },
    (value, index) => new Vec3(5 + index, 65, 0)
  )
  for (const position of additionalMature) {
    world.set(key(position), createBlock('wheat', position, 7))
    world.set(key(position.offset(0, -1, 0)), createBlock(
      'farmland',
      position.offset(0, -1, 0)
    ))
  }

  let digCalls = 0
  let blockCollectCalls = 0

  const bot = {
    registry: {
      blocksByName: BLOCKS,
      itemsByName: {
        wheat_seeds: { id: 951 },
        carrot: { id: 1227 },
        potato: { id: 1228 },
        beetroot_seeds: { id: 1288 }
      }
    },
    entity: {
      position: new Vec3(0, 65, 0),
      eyeHeight: 1.62
    },
    inventory: {
      items: () => inventory,
      emptySlotCount: () => options.emptySlots ?? 10
    },
    heldItem: null,
    targetDigBlock: null,
    entities: {},
    get digCalls() {
      return digCalls
    },
    get blockCollectCalls() {
      return blockCollectCalls
    },
    findBlocks({ matching }) {
      const ids = new Set(Array.isArray(matching) ? matching : [matching])
      const positions = Array.from(world.values())
        .filter((block) => ids.has(block.type))
        .map((block) => block.position)

      if (options.oneMaturePerScan && ids.has(BLOCKS.wheat.id)) {
        const maturePositions = positions.filter((position) => (
          getCropAge(world.get(key(position))) === 7
        ))
        const otherPositions = positions.filter((position) => (
          getCropAge(world.get(key(position))) !== 7
        ))
        return [...maturePositions.slice(0, 1), ...otherPositions]
      }

      return positions
    },
    findBlock() {
      return options.container || null
    },
    blockAt(position) {
      return world.get(key(position)) || createBlock('air', position)
    },
    collectBlock: {
      itemFilter: () => true,
      async collect(target, collectOptions) {
        bot.lastCollectOptions = collectOptions
        bot.lastCollectedTarget = target
        if (target && target.name !== 'item') blockCollectCalls += 1
      },
      async cancelTask() {}
    },
    pathfinder: {
      async goto() {},
      setGoal() {}
    },
    canDigBlock() {
      return options.canDigBlock !== false
    },
    async lookAt() {},
    async waitForTicks() {},
    async stopDigging() {
      bot.targetDigBlock = null
    },
    async dig(block) {
      digCalls += 1
      bot.targetDigBlock = block

      if (
        !options.digDoesNotBreak &&
        digCalls > (options.digFailuresBeforeSuccess || 0)
      ) {
        world.set(key(block.position), createBlock('air', block.position))
      }

      bot.targetDigBlock = null
    },
    async equip(item) {      bot.heldItem = item
    },
    async placeBlock(farmland, face) {
      const position = farmland.position.plus(face)
      world.set(key(position), createBlock('wheat', position, 0))
    },
    chat(message) {
      chats.push(message)
    }
  }

  return {
    bot,
    chats,
    world,
    mature,
    growing,
    empty,
    additionalMature
  }
}

test('crop aliases and modern block-state ages are recognized', () => {
  assert.equal(resolveCropName('carrot'), 'carrots')
  assert.equal(resolveCropName('beetroot seeds'), 'beetroots')
  assert.equal(resolveCropName('all crops'), 'all')
  assert.equal(getCropAge({ getProperties: () => ({ age: '7' }) }), 7)
})

test('farm status separates mature, growing, and empty farmland', () => {
  const { bot } = createBot()
  const status = getFarmStatus(bot, 'wheat', 16)

  assert.deepEqual(status, {
    range: 16,
    emptyFarmland: 1,
    crops: [{ crop: 'wheat', mature: 1, growing: 1, total: 2 }]
  })
})

test('farming harvests only mature crops and replants the same block', async () => {
  const { bot, mature, growing } = createBot()
  const result = await farmCrops(bot, 'wheat', 1)

  assert.equal(result.harvested, 1)
  assert.equal(result.replanted, 1)
  assert.equal(result.complete, true)
  assert.equal(bot.blockAt(mature).name, 'wheat')
  assert.equal(getCropAge(bot.blockAt(mature)), 0)
  assert.equal(getCropAge(bot.blockAt(growing)), 3)
  assert.equal(bot.digCalls, 1)
  assert.equal(bot.blockCollectCalls, 0)
})

test('farming rescans after each harvest instead of stopping after one crop', async () => {
  const { bot } = createBot({
    additionalMature: 2,
    oneMaturePerScan: true
  })
  const result = await farmCrops(bot, 'wheat', 3)

  assert.equal(result.harvested, 3)
  assert.equal(result.replanted, 3)
  assert.equal(result.complete, true)
})

test('farm all inspects status and harvests every mature requested crop', async () => {
  const { bot } = createBot({ additionalMature: 2 })
  const result = await farmCrops.farmAllAvailable(bot, 'wheat')

  assert.equal(result.availableAtStart, 3)
  assert.equal(result.harvested, 3)
  assert.equal(result.replanted, 3)
  assert.equal(result.farmStatus.crops[0].mature, 3)
})

test('a dig that the server does not confirm is retried and not counted', async () => {
  const { bot } = createBot({ digDoesNotBreak: true })
  const result = await farmCrops(bot, 'wheat', 1)

  assert.equal(result, false)
  assert.equal(bot.digCalls, 2)
})

test('a transient unconfirmed dig is retried before farming continues', async () => {
  const { bot } = createBot({ digFailuresBeforeSuccess: 1 })
  const result = await farmCrops(bot, 'wheat', 1)

  assert.equal(result.harvested, 1)
  assert.equal(result.replanted, 1)
  assert.equal(result.complete, true)
  assert.equal(bot.digCalls, 2)
})

test('a harvested crop reports a replant failure when no seed exists', async () => {
  const { bot } = createBot({ inventory: [] })
  const result = await farmCrops(bot, 'wheat', 1)

  assert.equal(result.harvested, 1)
  assert.equal(result.replanted, 0)
  assert.equal(result.complete, false)
  assert.equal(result.failures.length, 1)
})

test('unknown crops and a full inventory without a chest fail safely', async () => {
  const unknown = createBot()
  assert.equal(await farmCrops(unknown.bot, 'pumpkins', 1), false)
  assert.match(unknown.chats.at(-1), /do not recognize/i)

  const full = createBot({ emptySlots: 0 })
  assert.equal(await farmCrops(full.bot, 'wheat', 1), false)
  assert.match(full.chats.at(-1), /inventory is full/i)
})

test('an already-cancelled farming action does no work', async () => {
  const controller = new AbortController()
  controller.abort(new Error('test cancellation'))
  const { bot, mature } = createBot()

  await assert.rejects(
    farmCrops(bot, 'wheat', 1, { signal: controller.signal }),
    /test cancellation/
  )
  assert.equal(getCropAge(bot.blockAt(mature)), 7)
})
