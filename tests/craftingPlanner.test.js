const test = require('node:test')
const assert = require('node:assert/strict')
const makeItem = require('../src/crafting/makeItem')

function createFixture(initialCounts = {}, options = {}) {
  const ids = {
    oak_log: 1,
    oak_planks: 2,
    stick: 3,
    wooden_pickaxe: 4
  }
  const items = []
  const itemsByName = {}

  for (const [name, id] of Object.entries(ids)) {
    const item = { id, name }
    items[id] = item
    itemsByName[name] = item
  }

  const recipes = {
    [ids.oak_planks]: [{
      result: { id: ids.oak_planks, count: 4 },
      delta: [
        { id: ids.oak_log, count: -1 },
        { id: ids.oak_planks, count: 4 }
      ],
      requiresTable: false
    }],
    [ids.stick]: [{
      result: { id: ids.stick, count: 4 },
      delta: [
        { id: ids.oak_planks, count: -2 },
        { id: ids.stick, count: 4 }
      ],
      requiresTable: false
    }],
    [ids.wooden_pickaxe]: [{
      result: { id: ids.wooden_pickaxe, count: 1 },
      delta: [
        { id: ids.oak_planks, count: -3 },
        { id: ids.stick, count: -2 },
        { id: ids.wooden_pickaxe, count: 1 }
      ],
      requiresTable: true
    }]
  }
  const counts = new Map(
    Object.entries(initialCounts).map(([name, count]) => [ids[name], count])
  )
  const chats = []
  const craftedItems = []
  const table = {
    name: 'crafting_table',
    position: { x: 1, y: 64, z: 1 }
  }

  const bot = {
    registry: {
      items,
      itemsByName,
      blocksByName: { crafting_table: { id: 99 } }
    },
    inventory: {
      items() {
        return Array.from(counts)
          .filter(([, count]) => count > 0)
          .map(([type, count]) => ({ type, count }))
      },
      count(id) { return counts.get(id) || 0 }
    },
    recipesAll(id) { return recipes[id] || [] },
    findBlock() { return options.noTable ? null : table },
    blockAt() { return table },
    pathfinder: { async goto() {} },
    chat(message) { chats.push(message) },
    async craft(recipe, craftCount) {
      for (const change of recipe.delta) {
        counts.set(
          change.id,
          (counts.get(change.id) || 0) + change.count * craftCount
        )
      }
      craftedItems.push(recipe.result.id)
    }
  }

  return { bot, ids, counts, chats, craftedItems }
}

test('make creates intermediate materials before the requested item', async () => {
  const fixture = createFixture({ oak_log: 2 })

  const result = await makeItem(fixture.bot, 'wooden_pickaxe', 1)

  assert.equal(result, true)
  assert.equal(fixture.counts.get(fixture.ids.wooden_pickaxe), 1)
  assert.deepEqual(fixture.craftedItems, [
    fixture.ids.oak_planks,
    fixture.ids.oak_planks,
    fixture.ids.stick,
    fixture.ids.wooden_pickaxe
  ])
  assert.match(fixture.chats.at(-1), /Made 1 wooden_pickaxe/)
})

test('make reports raw materials instead of a missing intermediate', async () => {
  const fixture = createFixture()

  const result = await makeItem(fixture.bot, 'wooden_pickaxe', 1)

  assert.equal(result, false)
  assert.match(fixture.chats.at(-1), /oak_log/)
  assert.doesNotMatch(fixture.chats.at(-1), /oak_planks/)
})

test('make reuses intermediate ingredients already in inventory', async () => {
  const fixture = createFixture({ oak_planks: 3, stick: 2 })

  const result = await makeItem(fixture.bot, 'wooden_pickaxe', 1)

  assert.equal(result, true)
  assert.deepEqual(fixture.craftedItems, [fixture.ids.wooden_pickaxe])
})

test('make requires a nearby table before executing table recipes', async () => {
  const fixture = createFixture({ oak_log: 2 }, { noTable: true })

  const result = await makeItem(fixture.bot, 'wooden_pickaxe', 1)

  assert.equal(result, false)
  assert.match(fixture.chats.at(-1), /crafting table within 16 blocks/)
  assert.equal(fixture.craftedItems.length, 0)
})

test('make obeys cancellation before crafting begins', async () => {
  const fixture = createFixture({ oak_log: 2 })
  const controller = new AbortController()
  controller.abort(new Error('test cancellation'))

  await assert.rejects(
    makeItem(
      fixture.bot,
      'wooden_pickaxe',
      1,
      { signal: controller.signal }
    ),
    /test cancellation/
  )
  assert.equal(fixture.craftedItems.length, 0)
})
