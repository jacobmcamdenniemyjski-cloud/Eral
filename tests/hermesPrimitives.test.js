const test = require('node:test')
const assert = require('node:assert/strict')
const getScene = require('../src/perception/getScene')
const getRecipes = require('../src/crafting/getRecipes')
const eatNow = require('../src/survival/eatNow')
const fleeFromHostiles = require('../src/movement/fleeFromHostiles')
const pickupItems = require('../src/inventory/pickupItems')
const useBlock = require('../src/world/useBlock')

function position(x, y, z) {
  return {
    x,
    y,
    z,
    distanceTo(other) {
      return Math.sqrt(
        (x - other.x) ** 2 +
        (y - other.y) ** 2 +
        (z - other.z) ** 2
      )
    }
  }
}

test('scene reports only visible, useful nearby blocks', () => {
  const self = { id: 1, position: position(0, 64, 0) }
  const chestPosition = position(2, 64, 0)
  const hiddenPosition = position(3, 64, 0)
  const bot = {
    health: 20,
    food: 18,
    entity: self,
    entities: {
      self,
      player: {
        id: 2,
        username: 'jacob',
        type: 'player',
        position: position(4, 64, 0)
      }
    },
    inventory: {
      items: () => [{ name: 'oak_log', count: 4 }]
    },
    game: { dimension: 'overworld' },
    time: { timeOfDay: 6000 },
    isRaining: false,
    findBlocks: () => [chestPosition, hiddenPosition],
    blockAt: (where) => ({
      name: where === chestPosition ? 'chest' : 'furnace',
      position: where
    }),
    canSeeBlock: (block) => block.name === 'chest'
  }

  const scene = getScene(bot, 16)

  assert.equal(scene.visibleBlocks.length, 1)
  assert.equal(scene.visibleBlocks[0].name, 'chest')
  assert.equal(scene.entities[0].name, 'jacob')
  assert.match(scene.summary, /Visible: chest x1/)
})

test('recipe lookup translates authoritative recipe ids to item names', () => {
  const bot = {
    registry: {
      itemsByName: { stick: { id: 2 } },
      items: {
        1: { name: 'oak_planks' },
        2: { name: 'stick' }
      }
    },
    recipesAll: () => [{
      result: { id: 2, count: 4 },
      requiresTable: false,
      delta: [
        { id: 1, count: -2 },
        { id: 2, count: 4 }
      ]
    }]
  }

  assert.deepEqual(getRecipes(bot, 'stick'), {
    item: 'stick',
    recipes: [{
      resultCount: 4,
      requiresTable: false,
      ingredients: [{ item: 'oak_planks', count: 2 }]
    }]
  })
})

test('explicit eating chooses safe food and consumes it', async () => {
  const equipped = []
  let consumed = 0
  const bot = {
    food: 12,
    heldItem: null,
    registry: {
      foodsByName: {
        cooked_beef: { foodPoints: 8 },
        rotten_flesh: { foodPoints: 4 }
      }
    },
    inventory: {
      items: () => [
        { name: 'rotten_flesh', count: 2, slot: 1 },
        { name: 'cooked_beef', count: 3, slot: 2 }
      ]
    },
    equip: async (item) => equipped.push(item.name),
    consume: async () => { consumed += 1 }
  }

  const result = await eatNow(bot)

  assert.equal(result.ate, true)
  assert.deepEqual(equipped, ['cooked_beef'])
  assert.equal(consumed, 1)
})

test('fleeing selects the nearest hostile and moves away from it', async () => {
  const goals = []
  const bot = {
    entity: { position: position(10, 64, 10) },
    entities: {
      far: { name: 'zombie', position: position(1, 64, 10) },
      near: { name: 'skeleton', position: position(8, 64, 10) }
    },
    pathfinder: {
      goto: async (goal) => goals.push(goal)
    }
  }

  const result = await fleeFromHostiles(bot, { distance: 8 })

  assert.equal(result.hostile, 'skeleton')
  assert.equal(result.position.x, 18)
  assert.equal(goals.length, 1)
})

test('pickup walks to nearby dropped item entities', async () => {
  const targets = []
  let inventory = []
  const drop = {
    name: 'item',
    position: position(2, 64, 0)
  }
  const bot = {
    entity: { position: position(0, 64, 0) },
    entities: { drop },
    inventory: { items: () => inventory },
    pathfinder: {
      goto: async (goal) => {
        targets.push(goal)
        inventory = [{ name: 'wheat', count: 1 }]
      }
    },
    waitForTicks: async () => {}
  }

  const result = await pickupItems(bot)

  assert.equal(targets.length, 1)
  assert.equal(result.pickedUp, 1)
})

test('use block approaches and activates the requested block', async () => {
  const found = {
    name: 'chest',
    position: position(8, 64, 0)
  }
  let activated = null
  let moved = false
  const bot = {
    entity: { position: position(0, 64, 0) },
    registry: { blocksByName: { chest: { id: 54 } } },
    findBlock: () => found,
    blockAt: () => found,
    pathfinder: {
      goto: async () => { moved = true }
    },
    activateBlock: async (block) => { activated = block },
    currentWindow: {}
  }

  const result = await useBlock(bot, 'chest')

  assert.equal(moved, true)
  assert.equal(activated, found)
  assert.equal(result.openedWindow, true)
})
