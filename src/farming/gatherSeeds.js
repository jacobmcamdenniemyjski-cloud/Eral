const { goals } = require('mineflayer-pathfinder')
const withTimeout = require('../scheduler/withTimeout')

const VEGETATION_NAMES = [
  'short_grass',
  'grass',
  'fern',
  'tall_grass',
  'large_fern'
]
const DIG_TIMEOUT_MS = 10000
const DROP_TIMEOUT_MS = 30000
const BLOCK_CONFIRM_TICKS = 20
const DROP_SPAWN_TICKS = 4
const MAX_PLANTS_PER_SEED = 16

function cancellationError(signal) {
  return signal && signal.reason instanceof Error
    ? signal.reason
    : new Error('Seed gathering was cancelled.')
}

function throwIfCancelled(signal) {
  if (signal && signal.aborted) throw cancellationError(signal)
}

function distance(left, right) {
  if (!left || !right) return Infinity
  const dx = Number(left.x) - Number(right.x)
  const dy = Number(left.y) - Number(right.y)
  const dz = Number(left.z) - Number(right.z)
  return Math.sqrt((dx * dx) + (dy * dy) + (dz * dz))
}

function positionKey(position) {
  return `${position.x},${position.y},${position.z}`
}

function inventoryCount(bot, itemName) {
  return bot.inventory.items()
    .filter((item) => item.name === itemName)
    .reduce((total, item) => total + item.count, 0)
}

function waitTicks(bot, ticks) {
  if (typeof bot.waitForTicks === 'function') {
    return bot.waitForTicks(ticks)
  }
  return new Promise((resolve) => setTimeout(resolve, ticks * 50))
}

async function stopDiggingSafely(bot) {
  if (!bot.targetDigBlock || typeof bot.stopDigging !== 'function') return
  try {
    await bot.stopDigging()
  } catch (error) {
    console.log('[seeds] stop digging failed: ' + error.message)
  }
}

function vegetationIds(bot) {
  return VEGETATION_NAMES
    .map((name) => bot.registry.blocksByName[name])
    .filter(Boolean)
    .map((block) => block.id)
}

function findVegetation(bot, ids, maxDistance, count, excluded) {
  if (ids.length === 0) return []

  return bot.findBlocks({
    matching: ids,
    maxDistance,
    count
  })
    .filter((position) => !excluded.has(positionKey(position)))
    .map((position) => bot.blockAt(position))
    .filter((block) => block && ids.includes(block.type))
    .sort((left, right) => (
      distance(left.position, bot.entity.position) -
      distance(right.position, bot.entity.position)
    ))
}

async function moveWithinReach(bot, position, signal) {
  throwIfCancelled(signal)
  const eyePosition = {
    x: bot.entity.position.x,
    y: bot.entity.position.y + (bot.entity.eyeHeight || 1.62),
    z: bot.entity.position.z
  }
  const center = {
    x: position.x + 0.5,
    y: position.y + 0.5,
    z: position.z + 0.5
  }

  // Direct digging is intentional here. In particular, short grass occupying
  // Earl's own feet block must not be handed to collectblock's path planner.
  if (distance(eyePosition, center) <= 4.5) return

  await bot.pathfinder.goto(
    new goals.GoalNear(position.x, position.y, position.z, 1)
  )
  throwIfCancelled(signal)

  const movedEye = {
    x: bot.entity.position.x,
    y: bot.entity.position.y + (bot.entity.eyeHeight || 1.62),
    z: bot.entity.position.z
  }
  if (distance(movedEye, center) > 5) {
    throw new Error('could not get within seed-gathering range')
  }
}

async function waitForBlockChange(bot, position, originalType, signal) {
  for (let tick = 0; tick < BLOCK_CONFIRM_TICKS; tick += 1) {
    throwIfCancelled(signal)
    const current = bot.blockAt(position)
    if (!current || current.type !== originalType) return true
    await waitTicks(bot, 1)
  }
  return false
}

function droppedItemName(entity) {
  try {
    if (typeof entity.getDroppedItem === 'function') {
      return entity.getDroppedItem()?.name || null
    }
  } catch {}
  return entity.item?.name || null
}

function nearbySeedDrops(bot, position, radius = 6) {
  return Object.values(bot.entities || {})
    .filter((entity) => (
      entity &&
      entity.position &&
      droppedItemName(entity) === 'wheat_seeds' &&
      distance(entity.position, position) <= radius
    ))
    .sort((left, right) => (
      distance(left.position, bot.entity.position) -
      distance(right.position, bot.entity.position)
    ))
}

async function collectSeedDrops(bot, position, signal) {
  await waitTicks(bot, DROP_SPAWN_TICKS)
  throwIfCancelled(signal)

  if (!bot.collectBlock || typeof bot.collectBlock.collect !== 'function') return

  for (const drop of nearbySeedDrops(bot, position)) {
    throwIfCancelled(signal)
    try {
      await withTimeout(
        bot.collectBlock.collect(drop),
        DROP_TIMEOUT_MS,
        'collecting wheat seeds near ' + positionKey(position)
      )
    } catch (error) {
      if (signal && signal.aborted) throw cancellationError(signal)
      // Earl may have automatically picked the entity up while approaching it.
      console.log('[seeds] drop collection warning: ' + error.message)
    }
  }

  await waitTicks(bot, 2)
}

async function breakVegetation(bot, block, signal) {
  await moveWithinReach(bot, block.position, signal)
  throwIfCancelled(signal)

  const current = bot.blockAt(block.position)
  if (!current || current.type !== block.type) return false

  if (typeof bot.lookAt === 'function') {
    const position = current.position
    const target = typeof position.offset === 'function'
      ? position.offset(0.5, 0.5, 0.5)
      : { x: position.x + 0.5, y: position.y + 0.5, z: position.z + 0.5 }
    await bot.lookAt(target, true)
  }

  await withTimeout(
    bot.dig(current, true),
    DIG_TIMEOUT_MS,
    'breaking ' + current.name + ' at ' + positionKey(current.position),
    { onTimeout: () => stopDiggingSafely(bot) }
  )

  const changed = await waitForBlockChange(
    bot,
    current.position,
    current.type,
    signal
  )
  if (!changed) {
    await stopDiggingSafely(bot)
    throw new Error('the server did not confirm the vegetation was broken')
  }

  return true
}

async function gatherSeeds(bot, amount = 1, options = {}) {
  const { signal, maxDistance = 32 } = options
  throwIfCancelled(signal)

  const ids = vegetationIds(bot)
  if (ids.length === 0) {
    bot.chat('I cannot identify grass or ferns that can drop wheat seeds.')
    return false
  }

  const startingSeeds = inventoryCount(bot, 'wheat_seeds')
  const maxPlants = Math.min(
    Math.max(amount * MAX_PLANTS_PER_SEED, 32),
    256
  )
  const failed = new Set()
  let broken = 0

  while (
    inventoryCount(bot, 'wheat_seeds') - startingSeeds < amount &&
    broken < maxPlants
  ) {
    throwIfCancelled(signal)
    const candidates = findVegetation(
      bot,
      ids,
      maxDistance,
      maxPlants - broken,
      failed
    )
    if (candidates.length === 0) break

    const candidate = candidates[0]
    const key = positionKey(candidate.position)

    try {
      if (!await breakVegetation(bot, candidate, signal)) {
        failed.add(key)
        continue
      }
      broken += 1
      await collectSeedDrops(bot, candidate.position, signal)
      const gathered = inventoryCount(bot, 'wheat_seeds') - startingSeeds
      console.log(
        `[seeds] cleared ${broken} plants; collected ${gathered}/${amount} wheat seeds.`
      )
    } catch (error) {
      if (signal && signal.aborted) throw cancellationError(signal)
      failed.add(key)
      console.log('[seeds] skipping ' + key + ': ' + error.message)
      await stopDiggingSafely(bot)
      if (bot.pathfinder) bot.pathfinder.setGoal(null)
    }
  }

  const collected = Math.max(
    0,
    inventoryCount(bot, 'wheat_seeds') - startingSeeds
  )
  const result = {
    item: 'wheat_seeds',
    requested: amount,
    collected,
    plantsBroken: broken,
    complete: collected >= amount
  }

  if (result.complete) {
    bot.chat(
      `Collected ${collected} wheat seeds by clearing ${broken} nearby plants.`
    )
  } else if (broken === 0) {
    bot.chat('I cannot find reachable short grass or ferns nearby.')
  } else {
    bot.chat(
      `I collected ${collected} of ${amount} wheat seeds after clearing ${broken} plants.`
    )
  }

  return result
}

module.exports = gatherSeeds
module.exports.VEGETATION_NAMES = VEGETATION_NAMES
module.exports.breakVegetation = breakVegetation
module.exports.inventoryCount = inventoryCount
