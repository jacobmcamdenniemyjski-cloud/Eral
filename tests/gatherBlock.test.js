const test = require('node:test')
const assert = require('node:assert/strict')
const gatherBlock = require('../src/gathering/gatherBlock')

function createBot(options = {}) {
  const chats = []
  const collected = []
  const positions = options.positions || [{ x: 1, y: 64, z: 1 }]
  const tool = options.tool
  const collectionOptions = []
  let collectCalls = 0

  const bot = {
    heldItem: null,
    registry: {
      blocksByName: {
        stone: {
          id: 1,
          harvestTools: { 257: true }
        },
        chest: { id: 54 }
      }
    },
    inventory: {
      items: () => tool ? [tool] : [],
      emptySlotCount: () => options.emptySlots ?? 1
    },
    findBlock: () => options.container || null,
    findBlocks: () => positions,
    blockAt: (position) => ({ type: 1, position }),
    collectBlock: {
      async collect(block, collectOptions) {
        collectCalls += 1
        if (
          options.failCollectionAt === collectCalls &&
          options.collectionError
        ) {
          throw options.collectionError
        }
        collected.push(block.position)
        collectionOptions.push(collectOptions)
      },
      cancelTask() {}
    },
    pathfinder: {
      setGoal() {}
    },
    async equip(item) {
      bot.heldItem = item
    },
    chat(message) {
      chats.push(message)
    }
  }

  return { bot, chats, collected, collectionOptions }
}

test('missing-tool feedback includes the real block name', async () => {
  const { bot, chats } = createBot()
  const result = await gatherBlock(bot, 'stone', 1)

  assert.equal(result, false)
  assert.deepEqual(chats, ['I need a proper tool to gather stone.'])
})

test('gathering equips a valid tool and reaches the requested amount', async () => {
  const { bot, collected } = createBot({
    tool: { type: 257, name: 'iron_pickaxe' },
    positions: [
      { x: 1, y: 64, z: 1 },
      { x: 2, y: 64, z: 1 },
      { x: 3, y: 64, z: 1 }
    ]
  })

  const result = await gatherBlock(bot, 'stone', 2)

  assert.equal(result, true)
  assert.equal(bot.heldItem.name, 'iron_pickaxe')
  assert.equal(collected.length, 2)
})

test('an already-cancelled gathering action does no work', async () => {
  const controller = new AbortController()
  controller.abort(new Error('test cancellation'))

  const { bot, collected } = createBot({
    tool: { type: 257, name: 'iron_pickaxe' }
  })

  await assert.rejects(
    gatherBlock(bot, 'stone', 1, { signal: controller.signal }),
    /test cancellation/
  )
  assert.equal(collected.length, 0)
})

test('a full inventory uses a nearby chest instead of breaking gathering', async () => {
  const container = {
    name: 'chest',
    position: { x: 2, y: 64, z: 2 }
  }
  const { bot, collectionOptions } = createBot({
    tool: { type: 257, name: 'iron_pickaxe' },
    emptySlots: 0,
    container
  })

  const result = await gatherBlock(bot, 'stone', 1)

  assert.equal(result, true)
  assert.deepEqual(collectionOptions[0].chestLocations, [container.position])
})

test('a full inventory without a nearby chest fails once with a useful message', async () => {
  const { bot, chats, collected } = createBot({
    tool: { type: 257, name: 'iron_pickaxe' },
    emptySlots: 0
  })

  const result = await gatherBlock(bot, 'stone', 1)

  assert.equal(result, false)
  assert.equal(collected.length, 0)
  assert.match(chats.at(-1), /inventory is full/i)
})

test('gathering stops once if inventory becomes full during collection', async () => {
  const { bot, chats, collected } = createBot({
    tool: { type: 257, name: 'iron_pickaxe' },
    positions: [
      { x: 1, y: 64, z: 1 },
      { x: 2, y: 64, z: 1 },
      { x: 3, y: 64, z: 1 }
    ],
    failCollectionAt: 2,
    collectionError: new Error('There are no defined chest locations!')
  })

  const result = await gatherBlock(bot, 'stone', 3)

  assert.equal(result, false)
  assert.equal(collected.length, 1)
  assert.equal(chats.filter((message) => /inventory became full/i.test(message)).length, 1)
})
