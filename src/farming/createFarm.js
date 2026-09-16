const { Vec3 } = require('vec3')
const { waitForCondition, inventoryCount } = require('../actions/verifiedState')
const { CROP_DEFINITIONS, resolveCropName } = require('./crops')

const SOIL_NAMES = new Set(['dirt', 'grass_block', 'farmland'])
const PASSABLE_NAMES = new Set(['air', 'cave_air', 'void_air'])
const CLEARABLE_PLANTS = new Set([
  'short_grass', 'grass', 'fern', 'tall_grass', 'large_fern',
  'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet',
  'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip',
  'oxeye_daisy', 'cornflower', 'lily_of_the_valley', 'wither_rose'
])

function positionKey(position) {
  return `${position.x},${position.y},${position.z}`
}

function blockAt(bot, position) {
  return bot.blockAt(position instanceof Vec3
    ? position
    : new Vec3(position.x, position.y, position.z))
}

function waterPositions(bot, origin, width, depth) {
  const positions = []
  for (let x = origin.x - 4; x < origin.x + width + 4; x += 1) {
    for (let z = origin.z - 4; z < origin.z + depth + 4; z += 1) {
      const position = new Vec3(x, origin.y, z)
      const block = blockAt(bot, position)
      if (block && block.name === 'water') positions.push(position)
    }
  }
  return positions
}

function hydrated(position, water) {
  return water.some((candidate) => (
    Math.abs(candidate.x - position.x) <= 4 &&
    Math.abs(candidate.z - position.z) <= 4 &&
    Math.abs(candidate.y - position.y) <= 1
  ))
}

function throwIfCancelled(signal) {
  if (!signal || !signal.aborted) return
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error('Farm creation was cancelled.')
}

async function createFarm(bot, input, options = {}) {
  const { signal } = options
  const crop = resolveCropName(input.crop, { allowAll: false })
  const definition = crop && CROP_DEFINITIONS[crop]
  if (!definition) {
    return { status: 'failed', reason: `Unsupported farm crop: ${input.crop}` }
  }

  const origin = new Vec3(input.origin.x, input.origin.y, input.origin.z)
  const width = Number(input.width)
  const depth = Number(input.depth)
  const water = waterPositions(bot, origin, width, depth)
  const cells = []
  const problems = []

  for (let x = origin.x; x < origin.x + width; x += 1) {
    for (let z = origin.z; z < origin.z + depth; z += 1) {
      const soilPosition = new Vec3(x, origin.y, z)
      const soil = blockAt(bot, soilPosition)
      if (soil && soil.name === 'water') continue
      if (!soil || !SOIL_NAMES.has(soil.name)) {
        problems.push({ position: soilPosition, reason: `unsafe soil ${soil && soil.name}` })
        continue
      }
      if (!hydrated(soilPosition, water)) {
        problems.push({ position: soilPosition, reason: 'no water within four blocks' })
        continue
      }
      const above = blockAt(bot, soilPosition.offset(0, 1, 0))
      if (
        above &&
        !PASSABLE_NAMES.has(above.name) &&
        !CLEARABLE_PLANTS.has(above.name) &&
        above.name !== definition.block
      ) {
        problems.push({ position: above.position, reason: `blocked by ${above.name}` })
        continue
      }
      cells.push(soilPosition)
    }
  }

  if (cells.length === 0 || problems.length > 0) {
    return {
      status: 'failed',
      reason: 'The selected field is not safe, level, clear, and fully irrigated.',
      usableCells: cells.length,
      problems: problems.slice(0, 16),
      waterSources: water.map(positionKey)
    }
  }

  const hoe = bot.inventory.items().find((item) => /_hoe$/.test(item.name))
  if (!hoe || inventoryCount(bot, definition.seed) < cells.length) {
    return {
      status: 'failed',
      reason: `Need one hoe and ${cells.length} ${definition.seed}.`,
      requiredSeeds: cells.length,
      availableSeeds: inventoryCount(bot, definition.seed),
      hasHoe: Boolean(hoe)
    }
  }

  const evidence = []
  let tilled = 0
  let planted = 0

  for (const soilPosition of cells) {
    throwIfCancelled(signal)
    const cropPosition = soilPosition.offset(0, 1, 0)
    let above = blockAt(bot, cropPosition)
    if (above && CLEARABLE_PLANTS.has(above.name)) {
      await bot.dig(above, true)
      const cleared = await waitForCondition(bot, () => {
        const current = blockAt(bot, cropPosition)
        return !current || PASSABLE_NAMES.has(current.name)
      }, { ticks: 20, signal })
      if (!cleared) {
        return { status: 'partial', reason: 'Plant clearing was not confirmed.', tilled, planted, evidence }
      }
    }

    let soil = blockAt(bot, soilPosition)
    if (soil.name !== 'farmland') {
      await bot.equip(hoe, 'hand')
      await bot.activateBlock(soil)
      const confirmed = await waitForCondition(bot, () => {
        const current = blockAt(bot, soilPosition)
        return current && current.name === 'farmland'
      }, { ticks: 20, signal })
      if (!confirmed) {
        return { status: 'partial', reason: 'Tilling was not confirmed.', tilled, planted, evidence }
      }
    }
    tilled += 1

    above = blockAt(bot, cropPosition)
    if (above && above.name === definition.block) {
      planted += 1
      evidence.push({ position: positionKey(cropPosition), existing: true })
      continue
    }

    const currentSeed = bot.inventory.items().find(
      (item) => item.name === definition.seed && item.count > 0
    )
    if (!currentSeed) {
      return { status: 'partial', reason: 'Ran out of seeds.', tilled, planted, evidence }
    }
    const beforeSeeds = inventoryCount(bot, definition.seed)
    soil = blockAt(bot, soilPosition)
    await bot.equip(currentSeed, 'hand')
    await bot.placeBlock(soil, new Vec3(0, 1, 0))
    const confirmed = await waitForCondition(bot, () => {
      const current = blockAt(bot, cropPosition)
      return current && current.name === definition.block
    }, { ticks: 20, signal })
    const afterSeeds = inventoryCount(bot, definition.seed)
    if (!confirmed || afterSeeds > beforeSeeds - 1) {
      return {
        status: 'partial',
        reason: 'Planting was not confirmed by both block and inventory state.',
        tilled,
        planted,
        evidence
      }
    }
    planted += 1
    evidence.push({
      position: positionKey(cropPosition),
      block: definition.block,
      seedDelta: afterSeeds - beforeSeeds
    })
  }

  return {
    status: 'completed', crop, origin: input.origin, width, depth,
    tilled, planted, waterSources: water.map(positionKey), evidence
  }
}

module.exports = createFarm
module.exports.CLEARABLE_PLANTS = CLEARABLE_PLANTS
module.exports.hydrated = hydrated
