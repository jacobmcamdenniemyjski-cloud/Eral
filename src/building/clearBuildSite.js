const { breakVegetation } = require('../farming/gatherSeeds')

const CLEARABLE_PLANTS = new Set([
  'short_grass',
  'grass',
  'fern',
  'tall_grass',
  'large_fern',
  'dead_bush',
  'dandelion',
  'poppy',
  'blue_orchid',
  'allium',
  'azure_bluet',
  'red_tulip',
  'orange_tulip',
  'white_tulip',
  'pink_tulip',
  'oxeye_daisy',
  'cornflower',
  'lily_of_the_valley',
  'wither_rose',
  'sunflower',
  'lilac',
  'rose_bush',
  'peony',
  'torchflower',
  'pitcher_plant',
  'pink_petals',
  'wildflowers',
  'leaf_litter',
  'bush',
  'firefly_bush',
  'sweet_berry_bush',
  'cactus_flower'
])

function throwIfCancelled(signal) {
  if (signal && signal.aborted) {
    throw signal.reason || new Error('Build-site clearing was cancelled.')
  }
}

function offset(position, x, y, z) {
  if (position && typeof position.offset === 'function') {
    return position.offset(x, y, z)
  }
  return {
    x: position.x + x,
    y: position.y + y,
    z: position.z + z
  }
}

function key(position) {
  return `${position.x},${position.y},${position.z}`
}

function distance(left, right) {
  const dx = left.x - right.x
  const dy = left.y - right.y
  const dz = left.z - right.z
  return Math.sqrt((dx * dx) + (dy * dy) + (dz * dz))
}

function isClearablePlant(block) {
  return Boolean(block) && CLEARABLE_PLANTS.has(block.name)
}

function blockAt(bot, position) {
  const current = bot.entity && bot.entity.position
  if (current && typeof current.floored === 'function') {
    const base = current.floored()
    return bot.blockAt(base.offset(
      position.x - base.x,
      position.y - base.y,
      position.z - base.z
    ))
  }
  return bot.blockAt(position)
}

function lowerHalf(bot, block) {
  if (!block || typeof block.getProperties !== 'function') return block
  const properties = block.getProperties() || {}
  if (properties.half !== 'upper') return block

  const lower = blockAt(bot, offset(block.position, 0, -1, 0))
  return isClearablePlant(lower) ? lower : block
}

function bounds(origin, width, depth, margin) {
  return {
    minX: origin.x - margin,
    maxX: origin.x + width - 1 + margin,
    minZ: origin.z - margin,
    maxZ: origin.z + depth - 1 + margin
  }
}

function scanPlants(bot, origin, width, depth, margin, clearanceHeight, excluded = new Set()) {
  const area = bounds(origin, width, depth, margin)
  const plants = new Map()

  for (let x = area.minX; x <= area.maxX; x += 1) {
    for (let z = area.minZ; z <= area.maxZ; z += 1) {
      for (let y = origin.y; y <= origin.y + clearanceHeight; y += 1) {
        const block = blockAt(bot, { x, y, z })
        if (!isClearablePlant(block)) continue
        const target = lowerHalf(bot, block)
        if (!target || excluded.has(key(target.position))) continue
        plants.set(key(target.position), target)
      }
    }
  }

  return [...plants.values()].sort((left, right) => (
    distance(left.position, bot.entity.position) -
    distance(right.position, bot.entity.position)
  ))
}

function inspectFloorPlane(bot, origin, width, depth) {
  let unsupportedFloorCells = 0
  let solidObstructions = 0

  for (let x = origin.x; x < origin.x + width; x += 1) {
    for (let z = origin.z; z < origin.z + depth; z += 1) {
      const floor = blockAt(bot, { x, y: origin.y, z })
      const support = blockAt(bot, { x, y: origin.y - 1, z })

      if (!support || support.boundingBox !== 'block') {
        unsupportedFloorCells += 1
      }
      if (
        floor &&
        floor.boundingBox === 'block' &&
        !isClearablePlant(floor)
      ) {
        solidObstructions += 1
      }
    }
  }

  return { unsupportedFloorCells, solidObstructions }
}

function inspectBuildSite(bot, plan) {
  const margin = plan.margin ?? 2
  const clearanceHeight = plan.clearanceHeight ?? 3
  const plants = scanPlants(
    bot,
    plan.origin,
    plan.width,
    plan.depth,
    margin,
    clearanceHeight
  )
  const plane = inspectFloorPlane(bot, plan.origin, plan.width, plan.depth)
  return {
    origin: plan.origin,
    width: plan.width,
    depth: plan.depth,
    margin,
    clearanceHeight,
    plants: plants.map((block) => ({
      name: block.name,
      position: block.position
    })),
    plantsRemaining: plants.length,
    ...plane,
    ready: (
      plants.length === 0 &&
      plane.unsupportedFloorCells === 0 &&
      plane.solidObstructions === 0
    )
  }
}

async function clearBuildSite(bot, plan, options = {}) {
  const { signal } = options
  const margin = plan.margin ?? 2
  const clearanceHeight = plan.clearanceHeight ?? 3
  const failed = new Set()
  let plantsBroken = 0

  while (true) {
    throwIfCancelled(signal)
    const plants = scanPlants(
      bot,
      plan.origin,
      plan.width,
      plan.depth,
      margin,
      clearanceHeight,
      failed
    )
    if (plants.length === 0) break

    const plant = plants[0]
    try {
      if (await breakVegetation(bot, plant, signal)) plantsBroken += 1
      else failed.add(key(plant.position))
    } catch (error) {
      if (signal && signal.aborted) throw error
      failed.add(key(plant.position))
      console.log(`[build-site] skipping ${key(plant.position)}: ${error.message}`)
      if (bot.pathfinder) bot.pathfinder.setGoal(null)
    }
  }

  const inspection = inspectBuildSite(bot, plan)
  const summary = { ...inspection }
  delete summary.plants
  const result = {
    ...summary,
    plantsBroken,
    failedPlants: failed.size
  }

  if (result.ready) {
    bot.chat(`Build site ready; cleared ${plantsBroken} plants.`)
  } else {
    bot.chat(
      `Cleared ${plantsBroken} plants, but the site needs leveling: ` +
      `${inspection.solidObstructions} raised blocks and ` +
      `${inspection.unsupportedFloorCells} unsupported floor cells.`
    )
  }

  return result
}

module.exports = clearBuildSite
module.exports.CLEARABLE_PLANTS = CLEARABLE_PLANTS
module.exports.inspectFloorPlane = inspectFloorPlane
module.exports.inspectBuildSite = inspectBuildSite
module.exports.isClearablePlant = isClearablePlant
module.exports.scanPlants = scanPlants
