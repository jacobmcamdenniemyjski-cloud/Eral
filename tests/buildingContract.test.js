const test = require('node:test')
const assert = require('node:assert/strict')
const { Vec3 } = require('vec3')
const clearBuildSite = require('../src/building/clearBuildSite')
const { placeBlockAt } = require('../src/building/placeBlock')
const {
  inspectShelter,
  validateBuildPlan
} = require('../src/building/buildingContract')
const selectSkillTools = require('../src/llm/selectSkillTools')

function key(position) {
  return `${position.x},${position.y},${position.z}`
}

function block(name, position, options = {}) {
  return {
    name,
    type: options.type ?? 1,
    position: new Vec3(position.x, position.y, position.z),
    boundingBox: options.boundingBox || 'block',
    light: options.light ?? 10,
    getProperties: () => options.properties || {}
  }
}

const plan = {
  origin: { x: 0, y: 64, z: 0 },
  width: 5,
  depth: 5,
  interiorHeight: 3,
  doorPosition: { x: 2, y: 65, z: 0 }
}

test('Building Contract V1 rejects a raised or corner doorway and low ceiling', () => {
  const result = validateBuildPlan({
    ...plan,
    interiorHeight: 1,
    doorPosition: { x: 0, y: 66, z: 0 }
  })

  assert.equal(result.valid, false)
  assert.match(result.problems.join(' '), /interiorHeight/i)
  assert.match(result.problems.join(' '), /one block above/i)
  assert.match(result.problems.join(' '), /not in a corner/i)
})

test('finished shelter inspection enforces floor, entrance, utilities, and light', () => {
  const world = new Map()
  const put = (name, position, options) => {
    world.set(key(position), block(name, position, options))
  }

  for (let x = 0; x < 5; x += 1) {
    for (let z = 0; z < 5; z += 1) {
      put('oak_planks', { x, y: 64, z })
      put('oak_planks', { x, y: 68, z })
      for (let y = 65; y <= 67; y += 1) {
        const boundary = x === 0 || x === 4 || z === 0 || z === 4
        if (boundary) put('oak_planks', { x, y, z })
      }
    }
  }

  put('oak_door', { x: 2, y: 65, z: 0 }, {
    properties: { half: 'lower', facing: 'north', open: false }
  })
  put('oak_door', { x: 2, y: 66, z: 0 }, {
    properties: { half: 'upper', facing: 'north', open: false }
  })
  put('glass_pane', { x: 0, y: 66, z: 2 })
  put('chest', { x: 1, y: 65, z: 2 })
  put('crafting_table', { x: 2, y: 65, z: 2 })
  put('furnace', { x: 3, y: 65, z: 2 })
  put('torch', { x: 1, y: 66, z: 1 }, { boundingBox: 'empty' })

  const air = (position) => block('air', position, {
    type: 0,
    boundingBox: 'empty',
    light: 10
  })
  const bot = {
    entity: { position: new Vec3(2, 65, -2) },
    blockAt: (position) => world.get(key(position)) || air(position)
  }

  const result = inspectShelter(bot, plan)
  assert.equal(result.valid, true)
  assert.equal(result.features.windows, 1)
  assert.equal(result.features.storage, 1)
  assert.equal(result.features.craftingTables, 1)
  assert.equal(result.features.furnaces, 1)
  assert.ok(result.features.walkableInteriorCells > 0)

  world.delete('3,65,2')
  put('furnace', { x: 3, y: 66, z: 2 })
  const elevatedUtility = inspectShelter(bot, plan)
  assert.equal(elevatedUtility.features.furnaces, 1)
  assert.doesNotMatch(elevatedUtility.problems.join(' '), /missing a furnace/i)

  world.delete('3,66,2')
  const broken = inspectShelter(bot, plan)
  assert.equal(broken.valid, false)
  assert.match(broken.problems.join(' '), /missing a furnace/i)
})

test('site preparation clears short grass, flowers, and two-block plants', async () => {
  const world = new Map()
  let digs = 0
  const put = (name, position, options = {}) => {
    world.set(key(position), block(name, position, options))
  }

  for (let x = 0; x < 3; x += 1) {
    for (let z = 0; z < 3; z += 1) {
      put('dirt', { x, y: 63, z })
    }
  }
  put('short_grass', { x: 0, y: 64, z: 0 }, { boundingBox: 'empty' })
  put('blue_orchid', { x: 1, y: 64, z: 0 }, { boundingBox: 'empty' })
  put('rose_bush', { x: 2, y: 64, z: 0 }, {
    boundingBox: 'empty',
    properties: { half: 'lower' }
  })
  put('rose_bush', { x: 2, y: 65, z: 0 }, {
    boundingBox: 'empty',
    properties: { half: 'upper' }
  })

  const air = (position) => block('air', position, {
    type: 0,
    boundingBox: 'empty'
  })
  const bot = {
    entity: { position: new Vec3(1, 64, 1), eyeHeight: 1.62 },
    blockAt: (position) => world.get(key(position)) || air(position),
    pathfinder: { async goto() {}, setGoal() {} },
    async lookAt() {},
    async waitForTicks() {},
    async dig(target) {
      digs += 1
      world.delete(key(target.position))
      if (target.name === 'rose_bush') {
        world.delete(`${target.position.x},${target.position.y + 1},${target.position.z}`)
      }
    },
    chat() {}
  }

  const result = await clearBuildSite(bot, {
    origin: plan.origin,
    width: 3,
    depth: 3,
    margin: 0,
    clearanceHeight: 3
  })

  assert.equal(result.ready, true)
  assert.equal(result.plantsBroken, 3)
  assert.equal(result.plantsRemaining, 0)
  assert.equal(digs, 3)
})

test('block placement removes and confirms a plant occupying its target', async () => {
  const target = new Vec3(1, 64, 0)
  const support = new Vec3(1, 63, 0)
  const world = new Map([
    [key(target), block('short_grass', target, { boundingBox: 'empty' })],
    [key(support), block('dirt', support)]
  ])
  const air = (position) => block('air', position, {
    type: 0,
    boundingBox: 'empty'
  })
  let digs = 0
  let placements = 0
  const bot = {
    entity: { position: new Vec3(0, 64, 0), eyeHeight: 1.62 },
    entities: {},
    game: { gameMode: 'survival' },
    registry: {
      blocksByName: { oak_planks: { id: 5 } },
      itemsByName: { oak_planks: { id: 5 } }
    },
    inventory: { items: () => [{ name: 'oak_planks', count: 1 }] },
    blockAt: (position) => world.get(key(position)) || air(position),
    pathfinder: { async goto() {} },
    async waitForTicks() {},
    async lookAt() {},
    async dig(plant) {
      digs += 1
      world.delete(key(plant.position))
    },
    async equip(item) { bot.heldItem = item },
    async placeBlock(reference, face) {
      placements += 1
      const position = reference.position.plus(face)
      world.set(key(position), block('oak_planks', position))
    }
  }

  const result = await placeBlockAt(bot, 'oak_planks', target)
  assert.equal(result.status, 'completed')
  assert.equal(result.placed, true)
  assert.equal(result.evidence.confirmedBlock, 'oak_planks')
  assert.equal(digs, 1)
  assert.equal(placements, 1)
})

test('house requests expose every Building Contract V1 operation', () => {
  const names = [
    'get_scene',
    'get_inventory',
    'create_build_plan',
    'get_build_plan',
    'inspect_build_site',
    'prepare_build_plan_site',
    'place_build_plan_block',
    'advance_build_plan',
    'inspect_build_plan_shelter',
    'traverse_nearby_door'
  ]
  const selected = selectSkillTools(
    'build a small usable house here',
    names.map((name) => ({ name }))
  )

  assert.deepEqual(selected.map((tool) => tool.name), names)
})
