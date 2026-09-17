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
  const remaining = new Set(positions.map((position) => (
    `${position.x},${position.y},${position.z}`
  )))
  const inventory = tool ? [tool] : []
  const stored = { count: 0 }

  const bot = {
    heldItem: null,
    registry: {
      blocksByName: {
        stone: {
          id: 1,
          harvestTools: { 257: true },
          drops: [4]
        },
        chest: { id: 54 }
      },
      itemsByName: { stone: { id: 4 } }
    },
    inventory: {
      items: () => inventory,
      emptySlotCount: () => options.emptySlots ?? 1
    },
    findBlock: () => options.container || null,
    findBlocks: () => positions,
    blockAt: (position) => remaining.has(
      `${position.x},${position.y},${position.z}`
    )
      ? { type: 1, name: 'stone', position }
      : { type: 0, name: 'air', position },
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
        remaining.delete(
          `${block.position.x},${block.position.y},${block.position.z}`
        )
        if ((options.emptySlots ?? 1) === 0) {
          stored.count += 1
        } else {
          const stack = inventory.find((item) => item.type === 4)
          if (stack) stack.count += 1
          else inventory.push({ type: 4, name: 'stone', count: 1 })
        }
      },
      cancelTask() {}
    },
    pathfinder: {
      setGoal() {}
    },
    async equip(item) {
      bot.heldItem = item
    },
    async openContainer() {
      return {
        containerItems: () => stored.count > 0
          ? [{ type: 4, name: 'stone', count: stored.count }]
          : [],
        close() {}
      }
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

  assert.equal(result.status, 'completed')
  assert.equal(result.collected, 2)
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

  assert.equal(result.status, 'completed')
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

  assert.equal(result.status, 'partial')
  assert.equal(result.collected, 1)
  assert.equal(collected.length, 1)
  assert.equal(chats.filter((message) => /inventory became full/i.test(message)).length, 1)
})

test('generic gathering refuses player-placeable building blocks', async () => {
  const { bot, collected } = createBot()
  bot.registry.blocksByName.oak_planks = { id: 5, drops: [5] }
  bot.registry.itemsByName.oak_planks = { id: 5 }

  const result = await gatherBlock(bot, 'oak_planks', 1)

  assert.equal(result.status, 'failed')
  assert.match(result.message, /exact coordinates/i)
  assert.equal(collected.length, 0)
})

test('generic gathering skips protected coordinates without breaking them', async () => {
  const { bot, collected } = createBot({
    tool: { type: 257, name: 'iron_pickaxe' }
  })
  const result = await gatherBlock(bot, 'stone', 1, {
    isProtectedPosition: () => 'inside protected home area'
  })

  assert.equal(result.status, 'failed')
  assert.equal(result.protectedSkipped, 1)
  assert.equal(collected.length, 0)
})
