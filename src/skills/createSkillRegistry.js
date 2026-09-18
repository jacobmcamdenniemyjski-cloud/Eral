const followPlayer = require('../movement/followPlayer')
const goTo = require('../movement/goTo')
const lookAtPlayer = require('../movement/lookAtPlayer')
const findNearestBlock = require('../perception/findNearestBlock')
const getStatus = require('../perception/getStatus')
const getNearbyEntities = require('../perception/getNearbyEntities')
const getInventory = require('../perception/getInventory')
const getScene = require('../perception/getScene')
const gatherBlock = require('../gathering/gatherBlock')
const gatherSeeds = require('../farming/gatherSeeds')
const craftItem = require('../crafting/craftItem')
const makeItem = require('../crafting/makeItem')
const getRecipes = require('../crafting/getRecipes')
const smeltItem = require('../smelting/smeltItem')
const attackNearestHostile = require('../combat/attackNearestHostile')
const huntAnimals = require('../animals/huntAnimal')
const storeItem = require('../inventory/storeItem')
const takeItem = require('../inventory/takeItem')
const equipItem = require('../inventory/equipItem')
const pickupItems = require('../inventory/pickupItems')
const { placeBlock } = require('../building/placeBlock')
const buildLine = require('../building/buildLine')
const buildWall = require('../building/buildWall')
const buildFloor = require('../building/buildFloor')
const clearBuildSite = require('../building/clearBuildSite')
const { inspectBuildSite } = clearBuildSite
const {
  inspectShelter,
  validateBuildPlan
} = require('../building/buildingContract')
const farmCrops = require('../farming/farmCrops')
const getFarmStatus = require('../farming/getFarmStatus')
const createFarm = require('../farming/createFarm')
const LocationStore = require('../locations/LocationStore')
const {
  goToSavedLocation,
  markCurrentLocation
} = require('../locations/locationActions')
const sleepInBed = require('../survival/sleepInBed')
const eatNow = require('../survival/eatNow')
const fleeFromHostiles = require('../movement/fleeFromHostiles')
const traverseDoor = require('../movement/traverseDoor')
const useBlock = require('../world/useBlock')
const { breakBlockAt, inspectBlockAt } = require('../world/blockAt')
const { resolveResourceName } = require('../core/parseItemRequest')
const SkillRegistry = require('./SkillRegistry')
const BuildPlanStore = require('../building/BuildPlanStore')

const emptySchema = {
  type: 'object',
  properties: {},
  additionalProperties: false
}

const positionSchema = {
  type: 'object',
  properties: {
    x: { type: 'integer' },
    y: { type: 'integer' },
    z: { type: 'integer' }
  },
  required: ['x', 'y', 'z'],
  additionalProperties: false
}

function objectSchema(properties, required = []) {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false
  }
}

function resourceNameSchema(description) {
  return {
    type: 'string',
    minLength: 1,
    maxLength: 80,
    description
  }
}

function itemAmountSchema(kind, maximum = 64) {
  return objectSchema({
    [kind]: resourceNameSchema(`Minecraft ${kind} name.`),
    amount: {
      type: 'integer',
      minimum: 1,
      maximum,
      default: 1
    }
  }, [kind, 'amount'])
}

const locationNameSchema = {
  type: 'string',
  minLength: 1,
  maxLength: 48,
  pattern: '^[a-zA-Z0-9 _-]+$',
  description: 'Short saved location name such as home, mine, or village.'
}

const cropNameSchema = {
  type: 'string',
  enum: ['wheat', 'carrots', 'potatoes', 'beetroots', 'all'],
  description: 'Supported crop name, or all for every supported crop.'
}

const buildPlanSchema = objectSchema({
  origin: positionSchema,
  width: { type: 'integer', minimum: 3, maximum: 16 },
  depth: { type: 'integer', minimum: 3, maximum: 16 },
  interiorHeight: { type: 'integer', minimum: 2, maximum: 4 },
  doorPosition: positionSchema
}, ['origin', 'width', 'depth', 'interiorHeight', 'doorPosition'])

function createSkillRegistry(options) {
  const {
    bot,
    scheduler,
    combatReflex,
    deathTracker,
    actionCoordinator
  } = options
  const locationStore = options.locationStore || new LocationStore()
  const buildPlanStore = options.buildPlanStore || new BuildPlanStore()
  const registry = new SkillRegistry({ actionCoordinator })

  function normalize(name, kind) {
    return resolveResourceName(bot, name, kind) || name
  }

  function clearTaskIf(type, predicate = () => true) {
    const currentTask = scheduler.getCurrentTask()
    if (currentTask && currentTask.type === type && predicate(currentTask)) {
      scheduler.clearTask()
    }
  }

  async function gatherProtection() {
    let locations = []
    try {
      locations = await locationStore.list()
    } catch {}

    return (position) => {
      const plan = buildPlanStore.findProtectingPlan(position, { margin: 1 })
      if (plan) return `inside protected build plan ${plan.id}`

      for (const location of locations) {
        if (!['home', 'farm'].includes(location.name)) continue
        const horizontal = Math.max(
          Math.abs(Number(position.x) - Number(location.x)),
          Math.abs(Number(position.z) - Number(location.z))
        )
        const vertical = Math.abs(Number(position.y) - Number(location.y))
        const radius = location.name === 'home' ? 8 : 5
        if (horizontal <= radius && vertical <= 6) {
          return `inside protected ${location.name} area`
        }
      }
      return false
    }
  }

  function plannedAreaFailure(positions) {
    for (const position of positions) {
      const plan = buildPlanStore.findProtectingPlan(position)
      if (plan) {
        return {
          status: 'failed',
          code: 'BUILD_PLAN_LEDGER_REQUIRED',
          message: `Position ${position.x},${position.y},${position.z} belongs to build plan ${plan.id}; place its cells through place_build_plan_block.`
        }
      }
    }
    return null
  }

  function linePositions(origin, direction, length) {
    const offsets = {
      east: [1, 0, 0], west: [-1, 0, 0], up: [0, 1, 0],
      down: [0, -1, 0], south: [0, 0, 1], north: [0, 0, -1]
    }
    const value = offsets[direction] || [0, 0, 0]
    return Array.from({ length }, (_, index) => ({
      x: origin.x + value[0] * index,
      y: origin.y + value[1] * index,
      z: origin.z + value[2] * index
    }))
  }

  function assertPlanPlacement(plan, phase, position) {
    const definition = plan.definition
    const origin = definition.origin
    const maxX = origin.x + definition.width - 1
    const maxZ = origin.z + definition.depth - 1
    const maxWallY = origin.y + definition.interiorHeight
    const perimeter = position.x === origin.x || position.x === maxX ||
      position.z === origin.z || position.z === maxZ
    const phasePrerequisite = {
      floor: ['site_ready', 'floor'],
      walls: ['floor', 'walls'],
      roof: ['walls', 'roof'],
      door_and_windows: ['roof', 'door_and_windows'],
      furnishing: ['door_and_windows', 'furnishing']
    }
    if (!phasePrerequisite[phase].includes(plan.phase)) {
      return `Plan ${plan.id} is at ${plan.phase}; ${phase} placements are not yet allowed.`
    }
    if (phase === 'floor' && position.y !== origin.y) {
      return `Floor cells must be at y=${origin.y}.`
    }
    if (
      phase === 'walls' &&
      (!perimeter || position.y < origin.y + 1 || position.y > maxWallY)
    ) {
      return 'Wall cells must be on the perimeter within the planned interior height.'
    }
    const door = definition.doorPosition
    if (
      phase === 'walls' &&
      position.x === door.x &&
      position.z === door.z &&
      [door.y, door.y + 1].includes(position.y)
    ) {
      return 'Wall placement cannot fill either cell of the planned two-block doorway.'
    }
    if (phase === 'roof' && position.y !== maxWallY + 1) {
      return `Roof cells must be at y=${maxWallY + 1}.`
    }
    if (
      phase === 'door_and_windows' &&
      (!perimeter || position.y < origin.y + 1 || position.y > maxWallY)
    ) {
      return 'Door and window cells must be on the planned perimeter.'
    }
    if (
      phase === 'furnishing' &&
      (perimeter || position.y < origin.y + 1 || position.y > maxWallY)
    ) {
      return 'Furnishing cells must be inside the planned room.'
    }
    return null
  }

  registry.register({
    name: 'get_status',
    description: 'Read Earl health, hunger, and current coordinates.',
    inputSchema: emptySchema,
    safety: 'read_only',
    execute: async () => getStatus(bot)
  })

  registry.register({
    name: 'get_inventory',
    description: 'List item names and quantities in Earl inventory.',
    inputSchema: emptySchema,
    safety: 'read_only',
    execute: async () => getInventory(bot)
  })

  registry.register({
    name: 'scan_nearby',
    description: 'List nearby players, mobs, and other entities.',
    inputSchema: objectSchema({
      range: { type: 'integer', minimum: 1, maximum: 64, default: 16 }
    }, ['range']),
    safety: 'read_only',
    execute: async ({ range }) => getNearbyEntities(bot, range)
  })

  registry.register({
    name: 'find_block',
    description: 'Find the nearest visible block of a requested type.',
    inputSchema: objectSchema({
      block: resourceNameSchema('Minecraft block name.'),
      maxDistance: {
        type: 'integer',
        minimum: 1,
        maximum: 64,
        default: 32
      }
    }, ['block', 'maxDistance']),
    safety: 'read_only',
    execute: async ({ block, maxDistance }) => {
      const found = findNearestBlock(
        bot,
        normalize(block, 'block'),
        maxDistance
      )

      return found
        ? { name: found.name, position: found.position }
        : null
    }
  })

  registry.register({
    name: 'get_task',
    description: 'Read Earl current scheduled task.',
    inputSchema: emptySchema,
    safety: 'read_only',
    execute: async () => scheduler.getCurrentTask()
  })

  registry.register({
    name: 'get_saved_locations',
    description: 'List Earl saved named locations and their coordinates.',
    inputSchema: emptySchema,
    safety: 'read_only',
    execute: async () => locationStore.list()
  })

  registry.register({
    name: 'mark_location',
    description: 'Save Earl current coordinates under a short name. Use home to remember Earl home.',
    inputSchema: objectSchema({
      name: locationNameSchema
    }, ['name']),
    safety: 'world_write',
    execute: async ({ name }) => markCurrentLocation(bot, locationStore, name)
  })

  registry.register({
    name: 'forget_location',
    description: 'Remove one named saved location.',
    inputSchema: objectSchema({
      name: locationNameSchema
    }, ['name']),
    safety: 'world_write',
    execute: async ({ name }) => ({
      name,
      removed: await locationStore.remove(name)
    })
  })

  registry.register({
    name: 'go_to_location',
    description: 'Travel to a named saved location such as home, mine, farm, or village.',
    inputSchema: objectSchema({
      name: locationNameSchema
    }, ['name']),
    timeoutMs: 600000,
    safety: 'movement',
    execute: async ({ name }, context) => {
      const accepted = scheduler.setTask({
        type: 'goto_location',
        name,
        priority: 200
      })

      if (!accepted) return false

      try {
        return await goToSavedLocation(bot, locationStore, name, {
          tolerance: 2,
          signal: context.signal
        })
      } finally {
        clearTaskIf(
          'goto_location',
          (task) => task.name === name
        )
      }
    }
  })

  registry.register({
    name: 'sleep_in_bed',
    description: 'Find a nearby bed, walk to it, and sleep. Minecraft permits sleeping only when conditions allow it.',
    inputSchema: emptySchema,
    timeoutMs: 120000,
    safety: 'movement',
    execute: async (input, context) => {
      const accepted = scheduler.setTask({
        type: 'sleep',
        priority: 200
      })

      if (!accepted) return false

      try {
        return await sleepInBed(bot, {
          signal: context.signal,
          maxDistance: 32
        })
      } finally {
        clearTaskIf('sleep')
      }
    }
  })

  registry.register({
    name: 'get_scene',
    description: 'Return a fair-play summary of status, inventory, nearby entities, and visible notable blocks.',
    inputSchema: objectSchema({
      range: { type: 'integer', minimum: 4, maximum: 32 }
    }, ['range']),
    safety: 'read_only',
    execute: async ({ range }) => getScene(bot, range)
  })

  registry.register({
    name: 'get_recipes',
    description: 'Use the Minecraft registry to list authoritative recipes and required ingredients for an item.',
    inputSchema: objectSchema({
      item: resourceNameSchema('Minecraft output item name.')
    }, ['item']),
    safety: 'read_only',
    execute: async ({ item }) => getRecipes(
      bot,
      normalize(item, 'item')
    )
  })

  registry.register({
    name: 'get_deaths',
    description: 'List Earl recorded death locations and inventory snapshots.',
    inputSchema: emptySchema,
    safety: 'read_only',
    execute: async () => {
      if (!deathTracker) throw new Error('Death tracking is unavailable.')
      return deathTracker.list()
    }
  })

  registry.register({
    name: 'return_to_death',
    description: 'Travel to Earl most recently recorded death location.',
    inputSchema: emptySchema,
    timeoutMs: 600000,
    safety: 'movement',
    execute: async (input, context) => {
      if (!deathTracker) throw new Error('Death tracking is unavailable.')
      const accepted = scheduler.setTask({
        type: 'deathpoint',
        priority: 250
      })
      if (!accepted) return false

      try {
        return await deathTracker.returnToLatest({
          signal: context.signal
        })
      } finally {
        clearTaskIf('deathpoint')
      }
    }
  })

  registry.register({
    name: 'pickup_items',
    description: 'Walk over nearby dropped item entities and collect them.',
    inputSchema: objectSchema({
      maxDistance: { type: 'integer', minimum: 1, maximum: 32 },
      maxItems: { type: 'integer', minimum: 1, maximum: 64 }
    }, ['maxDistance', 'maxItems']),
    timeoutMs: 180000,
    safety: 'inventory_write',
    execute: async ({ maxDistance, maxItems }, context) => pickupItems(
      bot,
      { maxDistance, maxItems, signal: context.signal }
    )
  })

  registry.register({
    name: 'eat_now',
    description: 'Immediately eat the best safe food in Earl inventory when hungry.',
    inputSchema: emptySchema,
    timeoutMs: 30000,
    safety: 'inventory_write',
    execute: async (input, context) => eatNow(
      bot,
      { signal: context.signal }
    )
  })

  registry.register({
    name: 'flee_from_hostiles',
    description: 'Find the nearest hostile mob and path away from it.',
    inputSchema: objectSchema({
      distance: { type: 'integer', minimum: 4, maximum: 32 }
    }, ['distance']),
    timeoutMs: 120000,
    safety: 'movement',
    execute: async ({ distance }, context) => fleeFromHostiles(
      bot,
      { distance, signal: context.signal }
    )
  })

  registry.register({
    name: 'use_nearby_block',
    description: 'Approach and activate a nearby named block such as a door, lever, button, furnace, or chest.',
    inputSchema: objectSchema({
      block: resourceNameSchema('Minecraft block name to activate.'),
      maxDistance: { type: 'integer', minimum: 1, maximum: 32 }
    }, ['block', 'maxDistance']),
    timeoutMs: 60000,
    safety: 'world_write',
    execute: async ({ block, maxDistance }, context) => useBlock(
      bot,
      normalize(block, 'block'),
      { maxDistance, signal: context.signal }
    )
  })

  registry.register({
    name: 'follow_player',
    description: 'Continuously follow a visible player at a safe distance.',
    inputSchema: objectSchema({
      player: resourceNameSchema('Exact Minecraft player username.')
    }, ['player']),
    timeoutMs: 30000,
    safety: 'movement',
    execute: async ({ player }) => {
      const accepted = scheduler.setTask({
        type: 'follow',
        target: player,
        priority: 200
      })

      return accepted ? followPlayer(bot, player) : false
    }
  })

  registry.register({
    name: 'look_at_player',
    description: 'Turn Earl view toward a visible player.',
    inputSchema: objectSchema({
      player: resourceNameSchema('Exact Minecraft player username.')
    }, ['player']),
    timeoutMs: 30000,
    safety: 'movement',
    execute: async ({ player }) => lookAtPlayer(bot, player)
  })

  registry.register({
    name: 'go_to',
    description: 'Walk within two blocks of world coordinates.',
    inputSchema: objectSchema({
      x: { type: 'number' },
      y: { type: 'number' },
      z: { type: 'number' }
    }, ['x', 'y', 'z']),
    timeoutMs: 600000,
    safety: 'movement',
    execute: async ({ x, y, z }, context) => {
      const accepted = scheduler.setTask({
        type: 'goto',
        x,
        y,
        z,
        priority: 200
      })

      if (!accepted) return false

      try {
        return await goTo(bot, x, y, z, {
          tolerance: 2,
          signal: context.signal
        })
      } finally {
        clearTaskIf('goto', (task) => (
          task.x === x && task.y === y && task.z === z
        ))
      }
    }
  })

  registry.register({
    name: 'gather_block',
    description: 'Mine and collect nearby natural resource blocks with verified inventory/container gains. Refuses active build footprints, saved home/farm areas, and normally player-placed blocks; use break_block_at for an exact intentional removal.',
    inputSchema: itemAmountSchema('block'),
    timeoutMs: 600000,
    safety: 'world_write',
    execute: async ({ block, amount }, context) => {
      const isProtectedPosition = await gatherProtection()
      return gatherBlock(
        bot,
        normalize(block, 'block'),
        amount,
        { signal: context.signal, isProtectedPosition }
      )
    }
  })

  registry.register({
    name: 'inspect_block_at',
    description: 'Read the exact block and state at world coordinates without changing the world.',
    inputSchema: objectSchema({ position: positionSchema }, ['position']),
    safety: 'read_only',
    execute: async ({ position }) => inspectBlockAt(bot, position)
  })

  registry.register({
    name: 'break_block_at',
    description: 'Break exactly one block at known coordinates only when its current name matches expectedBlock. Use this for deliberate repairs or removing a known placed block; never use gather_block on structures.',
    inputSchema: objectSchema({
      position: positionSchema,
      expectedBlock: resourceNameSchema('Exact block expected at the target position.')
    }, ['position', 'expectedBlock']),
    timeoutMs: 120000,
    safety: 'world_write',
    execute: async ({ position, expectedBlock }, context) => breakBlockAt(
      bot,
      {
        position,
        expectedBlock: normalize(expectedBlock, 'block')
      },
      { signal: context.signal }
    )
  })

  registry.register({
    name: 'gather_seeds',
    description: 'Collect an actual requested number of wheat seeds by directly breaking nearby short grass or ferns, including vegetation under Earl feet. This handles random seed drops; use it instead of gather_block whenever seeds are needed.',
    inputSchema: objectSchema({
      amount: {
        type: 'integer',
        minimum: 1,
        maximum: 32,
        default: 1
      },
      maxDistance: {
        type: 'integer',
        minimum: 4,
        maximum: 32,
        default: 32
      }
    }, ['amount']),
    timeoutMs: 600000,
    safety: 'world_write',
    execute: async ({ amount, maxDistance }, context) => gatherSeeds(
      bot,
      amount,
      { signal: context.signal, maxDistance: maxDistance || 32 }
    )
  })

  registry.register({
    name: 'craft_item',
    description: 'Perform one crafting recipe using available ingredients.',
    inputSchema: itemAmountSchema('item'),
    timeoutMs: 120000,
    safety: 'inventory_write',
    execute: async ({ item, amount }, context) => craftItem(
      bot,
      normalize(item, 'item'),
      amount,
      { signal: context.signal }
    )
  })

  registry.register({
    name: 'make_item',
    description: 'Authoritative crafting planner for every make or craft request. Call this directly: it uses exact Minecraft registry recipes, checks inventory, crafts intermediate ingredients, and reports missing materials. Never calculate a recipe yourself.',
    inputSchema: itemAmountSchema('item'),
    timeoutMs: 300000,
    safety: 'inventory_write',
    execute: async ({ item, amount }, context) => makeItem(
      bot,
      normalize(item, 'item'),
      amount,
      { signal: context.signal }
    )
  })

  registry.register({
    name: 'get_farm_status',
    description: 'Count mature and growing wheat, carrots, potatoes, or beetroots plus empty farmland nearby.',
    inputSchema: objectSchema({
      crop: cropNameSchema
    }, ['crop']),
    safety: 'read_only',
    execute: async ({ crop }) => getFarmStatus(bot, crop, 16)
  })

  registry.register({
    name: 'create_farm',
    description: 'Create a verified, level, irrigated crop field. Preserves water, clears only small plants, tills dirt or grass, plants every usable cell, and refuses unsafe terrain or missing resources.',
    inputSchema: objectSchema({
      crop: {
        type: 'string',
        enum: ['wheat', 'carrots', 'potatoes', 'beetroots']
      },
      origin: positionSchema,
      width: { type: 'integer', minimum: 1, maximum: 9 },
      depth: { type: 'integer', minimum: 1, maximum: 9 }
    }, ['crop', 'origin', 'width', 'depth']),
    timeoutMs: 900000,
    safety: 'world_write',
    execute: async (input, context) => createFarm(
      bot,
      input,
      { signal: context.signal }
    )
  })

  registry.register({
    name: 'farm_crops',
    description: 'Harvest mature nearby wheat, carrots, potatoes, or beetroots, collect the drops, and immediately replant every harvested block.',
    inputSchema: objectSchema({
      crop: cropNameSchema,
      amount: {
        type: 'integer',
        minimum: 1,
        maximum: 64,
        default: 1
      }
    }, ['crop', 'amount']),
    timeoutMs: 600000,
    safety: 'world_write',
    execute: async ({ crop, amount }, context) => farmCrops(
      bot,
      crop,
      amount,
      { signal: context.signal, maxDistance: 16 }
    )
  })

  registry.register({
    name: 'farm_all_available',
    description: 'Inspect the nearby farm, count every currently mature requested crop, then harvest and replant all of them. Use this for collect all, harvest all, or farm everything requests.',
    inputSchema: objectSchema({
      crop: cropNameSchema
    }, ['crop']),
    timeoutMs: 1800000,
    safety: 'world_write',
    execute: async ({ crop }, context) => farmCrops.farmAllAvailable(
      bot,
      crop,
      { signal: context.signal, maxDistance: 16 }
    )
  })

  registry.register({
    name: 'get_furnace_status',
    description: 'Inspect the nearest furnace and report its input, fuel, output, progress, and remaining burn time.',
    inputSchema: emptySchema,
    timeoutMs: 60000,
    safety: 'read_only',
    execute: async (input, context) => smeltItem.getFurnaceStatus(
      bot,
      { signal: context.signal }
    )
  })

  registry.register({
    name: 'collect_furnace_output',
    description: 'Retrieve all currently finished output from the nearest furnace.',
    inputSchema: emptySchema,
    timeoutMs: 60000,
    safety: 'inventory_write',
    execute: async (input, context) => smeltItem.collectFurnaceOutput(
      bot,
      { signal: context.signal }
    )
  })

  registry.register({
    name: 'smelt_item',
    description: 'Add inventory items to a nearby compatible furnace load, reuse or add fuel, wait for completion, and collect all output.',
    inputSchema: objectSchema({
      item: resourceNameSchema('Minecraft input item to smelt.'),
      amount: {
        type: 'integer',
        minimum: 1,
        maximum: 64,
        default: 1
      },
      fuel: resourceNameSchema('Optional Minecraft furnace fuel item.')
    }, ['item', 'amount']),
    timeoutMs: 900000,
    safety: 'inventory_write',
    execute: async ({ item, amount, fuel }, context) => smeltItem(
      bot,
      normalize(item, 'item'),
      amount,
      {
        fuel: fuel ? normalize(fuel, 'item') : null,
        signal: context.signal
      }
    )
  })

  registry.register({
    name: 'store_item',
    description: 'Store inventory items in a nearby chest or barrel. This skill finds and opens the container itself; do not use scan_nearby to look for containers.',
    inputSchema: itemAmountSchema('item'),
    timeoutMs: 120000,
    safety: 'inventory_write',
    execute: async ({ item, amount }) => storeItem(
      bot,
      normalize(item, 'item'),
      amount
    )
  })

  registry.register({
    name: 'take_item',
    description: 'Take items from a nearby chest or barrel.',
    inputSchema: itemAmountSchema('item'),
    timeoutMs: 120000,
    safety: 'inventory_write',
    execute: async ({ item, amount }) => takeItem(
      bot,
      normalize(item, 'item'),
      amount
    )
  })

  registry.register({
    name: 'equip_item',
    description: 'Equip or hold an item already in Earl inventory.',
    inputSchema: objectSchema({
      item: resourceNameSchema('Minecraft item name.')
    }, ['item']),
    timeoutMs: 30000,
    safety: 'inventory_write',
    execute: async ({ item }) => equipItem(bot, normalize(item, 'item'))
  })

  registry.register({
    name: 'place_block',
    description: 'Place one inventory block at exact coordinates outside every persistent build-plan envelope. Use place_build_plan_block for a planned shelter.',
    inputSchema: objectSchema({
      block: resourceNameSchema('Minecraft block name.'),
      position: positionSchema
    }, ['block']),
    timeoutMs: 60000,
    safety: 'world_write',
    execute: async ({ block, position }, context) => {
      if (!position && buildPlanStore.list({ status: 'active' }).length > 0) {
        return {
          status: 'failed',
          message: 'An active build plan exists; provide exact coordinates through place_build_plan_block.'
        }
      }
      const protectedPlan = position
        ? buildPlanStore.findProtectingPlan(position)
        : null
      if (protectedPlan) {
        return {
          status: 'failed',
          message: `Position belongs to build plan ${protectedPlan.id}; use place_build_plan_block so the placement is persisted.`
        }
      }
      return placeBlock(
        bot,
        normalize(block, 'block'),
        position || null,
        { signal: context.signal }
      )
    }
  })

  registry.register({
    name: 'place_build_plan_block',
    description: 'Place and server-confirm one block inside a persistent build plan, then record the exact cell, phase, and block in the restart ledger.',
    inputSchema: objectSchema({
      id: { type: 'integer', minimum: 1 },
      phase: {
        type: 'string',
        enum: ['floor', 'walls', 'roof', 'door_and_windows', 'furnishing']
      },
      block: resourceNameSchema('Minecraft block name.'),
      position: positionSchema
    }, ['id', 'phase', 'block', 'position']),
    timeoutMs: 60000,
    safety: 'world_write',
    execute: async ({ id, phase, block, position }, context) => {
      const plan = buildPlanStore.get(id)
      if (!plan) throw new Error(`Unknown build plan id: ${id}`)
      if (plan.status !== 'active') {
        return {
          status: 'failed',
          message: `Build plan ${id} is ${plan.status}; review and resume it before placing blocks.`
        }
      }
      const protectingPlan = buildPlanStore.findProtectingPlan(position)
      if (!protectingPlan || protectingPlan.id !== id) {
        return {
          status: 'failed',
          message: `Position is outside the locked envelope for build plan ${id}.`
        }
      }
      const normalizedBlock = normalize(block, 'block')
      const placementProblem = assertPlanPlacement(plan, phase, position)
      if (placementProblem) {
        return {
          status: 'failed',
          code: 'BUILD_PLAN_PHASE_VIOLATION',
          message: placementProblem
        }
      }
      const result = await placeBlock(
        bot,
        normalizedBlock,
        position,
        { signal: context.signal }
      )
      if (!result || (result.status !== 'completed' && !result.skipped)) {
        return result
      }
      buildPlanStore.recordPosition(id, position, {
        phase,
        block: normalizedBlock,
        confirmedAt: new Date().toISOString()
      })
      return {
        ...result,
        plan: buildPlanStore.get(id)
      }
    }
  })

  registry.register({
    name: 'validate_build_plan',
    description: 'Validate a shelter plan against Building Contract V1 before placing anything: footprint, minimum headroom, and a floor-aligned non-corner doorway.',
    inputSchema: buildPlanSchema,
    safety: 'read_only',
    execute: async (plan) => validateBuildPlan(plan)
  })

  registry.register({
    name: 'create_build_plan',
    description: 'Validate and persist one locked Building Contract V1 plan. Later build phases must use this plan id so origin, elevation, footprint, and doorway cannot drift.',
    inputSchema: objectSchema({
      ...buildPlanSchema.properties,
      material: resourceNameSchema('Optional primary building material.'),
      requestId: { type: 'integer', minimum: 1 },
      intentionId: { type: 'integer', minimum: 1 }
    }, buildPlanSchema.required),
    safety: 'world_write',
    execute: async (input) => {
      const definition = {
        origin: input.origin,
        width: input.width,
        depth: input.depth,
        interiorHeight: input.interiorHeight,
        doorPosition: input.doorPosition
      }
      const validation = validateBuildPlan(definition)
      if (!validation.valid) {
        return {
          status: 'failed',
          reason: 'Build plan does not satisfy Building Contract V1.',
          validation
        }
      }
      return buildPlanStore.create(definition, {
        material: input.material || null,
        requestId: input.requestId,
        intentionId: input.intentionId
      })
    }
  })

  registry.register({
    name: 'get_build_plan',
    description: 'Read one persistent build plan, including its locked geometry, current phase, confirmed positions, and failures.',
    inputSchema: objectSchema({
      id: { type: 'integer', minimum: 1 }
    }, ['id']),
    safety: 'read_only',
    execute: async ({ id }) => buildPlanStore.get(id)
  })

  registry.register({
    name: 'list_build_plans',
    description: 'List persistent build plans. Paused plans require an explicit decision before work resumes.',
    inputSchema: objectSchema({
      status: {
        type: 'string',
        enum: ['all', 'active', 'paused', 'completed', 'failed']
      }
    }),
    safety: 'read_only',
    execute: async ({ status }) => buildPlanStore.list({ status: status || 'all' })
  })

  registry.register({
    name: 'resume_build_plan',
    description: 'Explicitly resume one paused build plan after inspecting its stored geometry and current world state.',
    inputSchema: objectSchema({
      id: { type: 'integer', minimum: 1 },
      reason: { type: 'string', minLength: 1, maxLength: 240 }
    }, ['id', 'reason']),
    safety: 'control',
    execute: async ({ id, reason }) => buildPlanStore.resume(id, reason)
  })

  registry.register({
    name: 'abort_build_plan',
    description: 'Permanently stop an obsolete or superseded build plan without altering blocks already placed.',
    inputSchema: objectSchema({
      id: { type: 'integer', minimum: 1 },
      reason: { type: 'string', minLength: 1, maxLength: 240 }
    }, ['id', 'reason']),
    safety: 'control',
    execute: async ({ id, reason }) => buildPlanStore.abort(id, reason)
  })

  registry.register({
    name: 'advance_build_plan',
    description: 'Record a verified phase transition for a persistent build plan. This never changes the locked geometry.',
    inputSchema: objectSchema({
      id: { type: 'integer', minimum: 1 },
      phase: {
        type: 'string',
        enum: ['planned', 'site_ready', 'floor', 'walls', 'roof', 'door_and_windows', 'furnishing', 'inspection', 'door_test', 'completed']
      },
      note: { type: 'string', maxLength: 240 }
    }, ['id', 'phase']),
    safety: 'world_write',
    execute: async ({ id, phase, note }) => buildPlanStore.advance(id, phase, note)
  })

  registry.register({
    name: 'prepare_build_plan_site',
    description: 'Clear the site for an existing persistent build plan using its locked origin and footprint, then advance it to site_ready only after verification.',
    inputSchema: objectSchema({
      id: { type: 'integer', minimum: 1 },
      margin: { type: 'integer', minimum: 0, maximum: 3 }
    }, ['id']),
    timeoutMs: 600000,
    safety: 'world_write',
    execute: async ({ id, margin }, context) => {
      const plan = buildPlanStore.get(id)
      if (!plan) throw new Error(`Unknown build plan id: ${id}`)
      const result = await clearBuildSite(bot, {
        origin: plan.definition.origin,
        width: plan.definition.width,
        depth: plan.definition.depth,
        margin: margin === undefined ? 2 : margin,
        clearanceHeight: plan.definition.interiorHeight + 1
      }, { signal: context.signal })
      if (result && result.ready) {
        buildPlanStore.advance(id, 'site_ready', 'Site clearing verified.')
      } else {
        buildPlanStore.pause(id, 'Site preparation requires review or leveling.')
      }
      return { plan: buildPlanStore.get(id), site: result }
    }
  })

  registry.register({
    name: 'inspect_build_plan_shelter',
    description: 'Inspect a shelter using the immutable geometry stored under its build plan id and persist the inspection result.',
    inputSchema: objectSchema({
      id: { type: 'integer', minimum: 1 }
    }, ['id']),
    safety: 'world_write',
    execute: async ({ id }) => {
      const plan = buildPlanStore.get(id)
      if (!plan) throw new Error(`Unknown build plan id: ${id}`)
      const inspection = inspectShelter(bot, plan.definition)
      if (inspection.valid) {
        buildPlanStore.advance(id, 'inspection', 'Shelter inspection passed.')
      }
      return { plan: buildPlanStore.get(id), inspection }
    }
  })

  registry.register({
    name: 'inspect_build_site',
    description: 'Read-only survey of vegetation, raised blocks, and unsupported floor cells for a proposed rectangular site. This never breaks or places blocks.',
    inputSchema: objectSchema({
      origin: positionSchema,
      width: { type: 'integer', minimum: 3, maximum: 16 },
      depth: { type: 'integer', minimum: 3, maximum: 16 },
      margin: { type: 'integer', minimum: 0, maximum: 3 },
      clearanceHeight: { type: 'integer', minimum: 2, maximum: 4 }
    }, ['origin', 'width', 'depth']),
    safety: 'read_only',
    execute: async (input) => inspectBuildSite(bot, input)
  })

  registry.register({
    name: 'clear_build_site',
    description: 'Destructively prepare a rectangular build footprint plus margin by directly breaking grass, ferns, flowers, and other small plants. Inspect first with inspect_build_site. It confirms every break and reports raised or unsupported cells that still need leveling.',
    inputSchema: objectSchema({
      origin: positionSchema,
      width: { type: 'integer', minimum: 3, maximum: 16 },
      depth: { type: 'integer', minimum: 3, maximum: 16 },
      margin: { type: 'integer', minimum: 0, maximum: 3 },
      clearanceHeight: { type: 'integer', minimum: 2, maximum: 4 }
    }, ['origin', 'width', 'depth']),
    timeoutMs: 600000,
    safety: 'world_write',
    execute: async (input, context) => clearBuildSite(
      bot,
      input,
      { signal: context.signal }
    )
  })

  registry.register({
    name: 'inspect_shelter',
    description: 'Inspect a finished shelter against Building Contract V1. Checks its floor, walls, two-block door, clear approaches, windows, storage, crafting table, furnace, and interior lighting.',
    inputSchema: buildPlanSchema,
    safety: 'read_only',
    execute: async (plan) => inspectShelter(bot, plan)
  })

  registry.register({
    name: 'traverse_nearby_door',
    description: 'Approach the nearest hand-openable door, confirm it opens, walk completely through it, optionally return through it to prove both directions work, and optionally close it behind Earl.',
    inputSchema: objectSchema({
      maxDistance: { type: 'integer', minimum: 2, maximum: 32 },
      closeBehind: { type: 'boolean' },
      returnThrough: { type: 'boolean' }
    }, ['maxDistance', 'closeBehind', 'returnThrough']),
    timeoutMs: 120000,
    safety: 'movement',
    execute: async ({ maxDistance, closeBehind, returnThrough }, context) => traverseDoor(
      bot,
      { maxDistance, closeBehind, returnThrough, signal: context.signal }
    )
  })

  registry.register({
    name: 'build_line',
    description: 'Build a straight line outside persistent build-plan envelopes. Planned shelters must use place_build_plan_block so every cell is recorded.',
    inputSchema: objectSchema({
      block: resourceNameSchema('Minecraft block name.'),
      origin: positionSchema,
      direction: {
        type: 'string',
        enum: ['north', 'south', 'east', 'west', 'up', 'down']
      },
      length: { type: 'integer', minimum: 1, maximum: 32 }
    }, ['block', 'origin', 'direction', 'length']),
    timeoutMs: 180000,
    safety: 'world_write',
    execute: async ({ block, origin, direction, length }, context) => {
      const blocked = plannedAreaFailure(linePositions(origin, direction, length))
      if (blocked) return blocked
      return buildLine(
        bot,
        normalize(block, 'block'),
        origin,
        direction,
        length,
        { signal: context.signal }
      )
    }
  })

  registry.register({
    name: 'build_wall',
    description: 'Build a vertical wall from an origin.',
    inputSchema: objectSchema({
      block: resourceNameSchema('Minecraft block name.'),
      origin: positionSchema,
      direction: {
        type: 'string',
        enum: ['north', 'south', 'east', 'west']
      },
      width: { type: 'integer', minimum: 1, maximum: 16 },
      height: { type: 'integer', minimum: 1, maximum: 5 }
    }, ['block', 'origin', 'direction', 'width', 'height']),
    timeoutMs: 300000,
    safety: 'world_write',
    execute: async ({ block, origin, direction, width, height }, context) => {
      const row = linePositions(origin, direction, width)
      const positions = row.flatMap((position) => (
        Array.from({ length: height }, (_, y) => ({ ...position, y: origin.y + y }))
      ))
      const blocked = plannedAreaFailure(positions)
      if (blocked) return blocked
      return buildWall(
        bot,
        normalize(block, 'block'),
        origin,
        direction,
        width,
        height,
        { signal: context.signal }
      )
    }
  })

  registry.register({
    name: 'build_floor',
    description: 'Build a rectangular floor from an origin.',
    inputSchema: objectSchema({
      block: resourceNameSchema('Minecraft block name.'),
      origin: positionSchema,
      width: { type: 'integer', minimum: 1, maximum: 16 },
      depth: { type: 'integer', minimum: 1, maximum: 16 }
    }, ['block', 'origin', 'width', 'depth']),
    timeoutMs: 600000,
    safety: 'world_write',
    execute: async ({ block, origin, width, depth }, context) => {
      const positions = []
      for (let z = 0; z < depth; z += 1) {
        for (let x = 0; x < width; x += 1) {
          positions.push({ x: origin.x + x, y: origin.y, z: origin.z + z })
        }
      }
      const blocked = plannedAreaFailure(positions)
      if (blocked) return blocked
      return buildFloor(
        bot,
        normalize(block, 'block'),
        origin,
        width,
        depth,
        { signal: context.signal }
      )
    }
  })

  registry.register({
    name: 'attack_hostile',
    description: 'Attack the nearest requested hostile mob within range.',
    inputSchema: objectSchema({
      mob: resourceNameSchema('Supported hostile mob name.'),
      maxDistance: {
        type: 'integer',
        minimum: 1,
        maximum: 32,
        default: 16
      }
    }, ['mob', 'maxDistance']),
    timeoutMs: 120000,
    safety: 'combat',
    execute: async ({ mob, maxDistance }, context) => {
      const target = mob.toLowerCase().replace(/^minecraft:/, '')
      const accepted = scheduler.setTask({
        type: 'attack',
        target,
        priority: 300
      })

      if (!accepted) return false

      try {
        return await attackNearestHostile(
          bot,
          target,
          maxDistance,
          { signal: context.signal }
        )
      } finally {
        clearTaskIf('attack', (task) => task.target === target)
      }
    }
  })

  registry.register({
    name: 'hunt_animal',
    description: 'Hunt approved passive animals for food or materials, confirm each kill, and collect the resulting drops. Supports sheep, cows, pigs, chickens, rabbits, and mooshrooms.',
    inputSchema: objectSchema({
      animal: {
        type: 'string',
        enum: Array.from(huntAnimals.PASSIVE_ANIMALS).sort(),
        description: 'Approved passive animal to hunt.'
      },
      amount: {
        type: 'integer',
        minimum: 1,
        maximum: 16,
        default: 1
      },
      maxDistance: {
        type: 'integer',
        minimum: 1,
        maximum: 32,
        default: 16
      }
    }, ['animal', 'amount', 'maxDistance']),
    timeoutMs: 300000,
    safety: 'combat',
    execute: async ({ animal, amount, maxDistance }, context) => {
      const accepted = scheduler.setTask({
        type: 'hunt',
        target: animal,
        amount,
        priority: 250
      })
      if (!accepted) return false

      try {
        return await huntAnimals(bot, animal, amount, {
          maxDistance,
          signal: context.signal
        })
      } finally {
        clearTaskIf('hunt', (task) => task.target === animal)
      }
    }
  })

  registry.register({
    name: 'set_combat_mode',
    description: 'Set automatic combat behavior and protected player.',
    inputSchema: objectSchema({
      mode: {
        type: 'string',
        enum: ['passive', 'defensive', 'guard', 'aggressive']
      },
      player: resourceNameSchema('Player Earl should protect.')
    }, ['mode', 'player']),
    safety: 'control',
    execute: async ({ mode, player }) => {
      if (!combatReflex.setMode(mode, player)) return false
      return combatReflex.getStatus()
    }
  })

  registry.register({
    name: 'get_combat_status',
    description: 'Read automatic combat mode and current protection state.',
    inputSchema: emptySchema,
    safety: 'read_only',
    execute: async () => combatReflex.getStatus()
  })

  registry.register({
    name: 'stop_all',
    description: 'Immediately cancel Earl current action, movement, or combat.',
    inputSchema: emptySchema,
    safety: 'control',
    execute: async (input, context) => {
      combatReflex.suppress(10000)

      if (typeof context.stopQueue === 'function') {
        await context.stopQueue()
      } else if (typeof context.cancelActiveWork === 'function') {
        await context.cancelActiveWork('stopped through skill registry')
      }

      return { stopped: true }
    }
  })

  registry.locationStore = locationStore
  registry.buildPlanStore = buildPlanStore
  return registry
}

module.exports = createSkillRegistry
