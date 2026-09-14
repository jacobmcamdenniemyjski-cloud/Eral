const followPlayer = require('../movement/followPlayer')
const goTo = require('../movement/goTo')
const lookAtPlayer = require('../movement/lookAtPlayer')
const findNearestBlock = require('../perception/findNearestBlock')
const getStatus = require('../perception/getStatus')
const getNearbyEntities = require('../perception/getNearbyEntities')
const getInventory = require('../perception/getInventory')
const getScene = require('../perception/getScene')
const gatherBlock = require('../gathering/gatherBlock')
const craftItem = require('../crafting/craftItem')
const makeItem = require('../crafting/makeItem')
const getRecipes = require('../crafting/getRecipes')
const smeltItem = require('../smelting/smeltItem')
const attackNearestHostile = require('../combat/attackNearestHostile')
const storeItem = require('../inventory/storeItem')
const takeItem = require('../inventory/takeItem')
const equipItem = require('../inventory/equipItem')
const pickupItems = require('../inventory/pickupItems')
const { placeBlock } = require('../building/placeBlock')
const buildLine = require('../building/buildLine')
const buildWall = require('../building/buildWall')
const buildFloor = require('../building/buildFloor')
const farmCrops = require('../farming/farmCrops')
const getFarmStatus = require('../farming/getFarmStatus')
const LocationStore = require('../locations/LocationStore')
const {
  goToSavedLocation,
  markCurrentLocation
} = require('../locations/locationActions')
const sleepInBed = require('../survival/sleepInBed')
const eatNow = require('../survival/eatNow')
const fleeFromHostiles = require('../movement/fleeFromHostiles')
const useBlock = require('../world/useBlock')
const { resolveResourceName } = require('../core/parseItemRequest')
const SkillRegistry = require('./SkillRegistry')

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

function createSkillRegistry(options) {
  const { bot, scheduler, combatReflex, deathTracker } = options
  const locationStore = options.locationStore || new LocationStore()
  const registry = new SkillRegistry()

  function normalize(name, kind) {
    return resolveResourceName(bot, name, kind) || name
  }

  function clearTaskIf(type, predicate = () => true) {
    const currentTask = scheduler.getCurrentTask()
    if (currentTask && currentTask.type === type && predicate(currentTask)) {
      scheduler.clearTask()
    }
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
    description: 'Mine and collect nearby blocks. Generic log, logs, wood, tree, and trees names are accepted and resolve to a nearby log species.',
    inputSchema: itemAmountSchema('block'),
    timeoutMs: 600000,
    safety: 'world_write',
    execute: async ({ block, amount }, context) => gatherBlock(
      bot,
      normalize(block, 'block'),
      amount,
      { signal: context.signal }
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
    description: 'Place one inventory block nearby or at exact coordinates.',
    inputSchema: objectSchema({
      block: resourceNameSchema('Minecraft block name.'),
      position: positionSchema
    }, ['block']),
    timeoutMs: 60000,
    safety: 'world_write',
    execute: async ({ block, position }, context) => placeBlock(
      bot,
      normalize(block, 'block'),
      position || null,
      { signal: context.signal }
    )
  })

  registry.register({
    name: 'build_line',
    description: 'Build a straight line of blocks from an origin.',
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
    execute: async ({ block, origin, direction, length }, context) => (
      buildLine(
        bot,
        normalize(block, 'block'),
        origin,
        direction,
        length,
        { signal: context.signal }
      )
    )
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
    execute: async ({ block, origin, direction, width, height }, context) => (
      buildWall(
        bot,
        normalize(block, 'block'),
        origin,
        direction,
        width,
        height,
        { signal: context.signal }
      )
    )
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
    execute: async ({ block, origin, width, depth }, context) => buildFloor(
      bot,
      normalize(block, 'block'),
      origin,
      width,
      depth,
      { signal: context.signal }
    )
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
  return registry
}

module.exports = createSkillRegistry
