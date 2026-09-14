const { goals } = require('mineflayer-pathfinder')
const withTimeout = require('../scheduler/withTimeout')
const findNearbyContainer = require('../inventory/findNearbyContainer')
const getFarmStatus = require('./getFarmStatus')
const {
  getCropDefinitions,
  isMatureCrop,
  resolveCropName
} = require('./crops')

const COLLECT_TIMEOUT_MS = 45000
const HARVEST_TIMEOUT_MS = 10000
const BLOCK_CONFIRM_TICKS = 20
const DROP_SPAWN_TICKS = 3
const MAX_HARVEST_ATTEMPTS = 2

function cancellationError(signal) {
  return signal && signal.reason instanceof Error
    ? signal.reason
    : new Error('Farming was cancelled.')
}

function throwIfCancelled(signal) {
  if (signal && signal.aborted) throw cancellationError(signal)
}

async function cancelFarming(bot) {
  if (
    bot.collectBlock &&
    typeof bot.collectBlock.cancelTask === 'function'
  ) {
    await Promise.race([
      Promise.resolve(bot.collectBlock.cancelTask()),
      new Promise((resolve) => setTimeout(resolve, 1000))
    ])
  }

  if (bot.pathfinder) bot.pathfinder.setGoal(null)

  if (bot.targetDigBlock && typeof bot.stopDigging === 'function') {
    try {
      await bot.stopDigging()
    } catch (error) {
      console.log('[farm] stop digging cleanup failed: ' + error.message)
    }
  }
}

function findMatureCrops(bot, definitions, amount, maxDistance) {
  const blockIds = definitions
    .map((definition) => bot.registry.blocksByName[definition.block])
    .filter(Boolean)
    .map((block) => block.id)
  const byBlockId = new Map(
    definitions.map((definition) => [
      bot.registry.blocksByName[definition.block]?.id,
      definition
    ])
  )

  if (blockIds.length === 0) return []

  const positions = bot.findBlocks({
    matching: blockIds,
    maxDistance,
    count: Math.min(Math.max(amount * 4, 64), 256)
  })

  return positions
    .map((position) => {
      const block = bot.blockAt(position)
      const definition = block && byBlockId.get(block.type)
      return isMatureCrop(block, definition)
        ? { position, definition }
        : null
    })
    .filter(Boolean)
    .sort((left, right) => (
      left.position.distanceTo(bot.entity.position) -
      right.position.distanceTo(bot.entity.position)
    ))
}

function seedPreservingFilter(bot, seedName) {
  const fallback = bot.collectBlock && bot.collectBlock.itemFilter
  return (item) => {
    if (item.name === seedName) return false
    return typeof fallback === 'function' ? fallback(item) : true
  }
}

function positionKey(position) {
  return `${position.x},${position.y},${position.z}`
}

async function waitTicks(bot, ticks) {
  if (typeof bot.waitForTicks === 'function') {
    await bot.waitForTicks(ticks)
    return
  }

  await new Promise((resolve) => setTimeout(resolve, ticks * 50))
}

async function moveWithinCropReach(bot, position, signal) {
  throwIfCancelled(signal)

  const cropCenter = position.offset(0.5, 0.5, 0.5)
  const eyePosition = bot.entity.position.offset(
    0,
    bot.entity.eyeHeight || 1.62,
    0
  )

  if (eyePosition.distanceTo(cropCenter) <= 4.5) return

  await bot.pathfinder.goto(
    new goals.GoalNear(position.x, position.y, position.z, 1)
  )

  throwIfCancelled(signal)
  const newEyePosition = bot.entity.position.offset(
    0,
    bot.entity.eyeHeight || 1.62,
    0
  )

  if (newEyePosition.distanceTo(cropCenter) > 5) {
    throw new Error('could not get within harvesting range')
  }
}

async function stopDiggingSafely(bot) {
  if (!bot.targetDigBlock || typeof bot.stopDigging !== 'function') return

  try {
    await bot.stopDigging()
  } catch (error) {
    console.log('[farm] stop digging failed: ' + error.message)
  }
}

async function waitForCropChange(bot, position, definition, signal) {
  for (let tick = 0; tick < BLOCK_CONFIRM_TICKS; tick += 1) {
    throwIfCancelled(signal)
    const current = bot.blockAt(position)
    if (!isMatureCrop(current, definition)) return current
    await waitTicks(bot, 1)
  }

  return bot.blockAt(position)
}

async function harvestCropBlock(bot, position, definition, signal) {
  let lastError = null

  for (let attempt = 1; attempt <= MAX_HARVEST_ATTEMPTS; attempt += 1) {
    throwIfCancelled(signal)
    await moveWithinCropReach(bot, position, signal)

    const block = bot.blockAt(position)
    if (!isMatureCrop(block, definition)) {
      return { harvested: false, reason: 'crop is no longer mature' }
    }

    if (
      typeof bot.canDigBlock === 'function' &&
      !bot.canDigBlock(block)
    ) {
      lastError = new Error('crop is not reachable from the current position')
      continue
    }

    console.log(
      '[farm] breaking ' + definition.crop + ' at ' + position +
      ' (attempt ' + attempt + '/' + MAX_HARVEST_ATTEMPTS + ').'
    )

    if (typeof bot.lookAt === 'function') {
      await bot.lookAt(position.offset(0.5, 0.5, 0.5), true)
    }

    try {
      await withTimeout(
        bot.dig(block, true),
        HARVEST_TIMEOUT_MS,
        'breaking ' + definition.crop + ' at ' + position,
        { onTimeout: () => stopDiggingSafely(bot) }
      )
    } catch (error) {
      if (signal && signal.aborted) throw cancellationError(signal)
      lastError = error
      await stopDiggingSafely(bot)
      continue
    }

    const afterHarvest = await waitForCropChange(
      bot,
      position,
      definition,
      signal
    )

    if (!isMatureCrop(afterHarvest, definition)) {
      return { harvested: true, attempts: attempt }
    }

    lastError = new Error('the server did not confirm the crop was broken')
    await stopDiggingSafely(bot)
    await waitTicks(bot, 2)
  }

  throw lastError || new Error('the crop could not be harvested')
}

function nearbyItemDrops(bot, position, radius = 6) {
  return Object.values(bot.entities || {})
    .filter((entity) => (
      entity &&
      entity.name === 'item' &&
      entity.position &&
      entity.position.distanceTo(position) <= radius
    ))
    .sort((left, right) => (
      left.position.distanceTo(bot.entity.position) -
      right.position.distanceTo(bot.entity.position)
    ))
}

async function collectCropDrops(
  bot,
  position,
  chestLocations,
  seedName,
  signal
) {
  if (!bot.collectBlock || typeof bot.collectBlock.collect !== 'function') {
    return { collected: 0 }
  }

  await waitTicks(bot, DROP_SPAWN_TICKS)
  throwIfCancelled(signal)

  const drops = nearbyItemDrops(bot, position)
  let collected = 0

  for (const drop of drops) {
    throwIfCancelled(signal)

    try {
      await withTimeout(
        bot.collectBlock.collect(drop, {
          chestLocations,
          itemFilter: seedPreservingFilter(bot, seedName)
        }),
        COLLECT_TIMEOUT_MS,
        'collecting crop drops near ' + position,
        { onTimeout: () => cancelFarming(bot) }
      )
      collected += 1
    } catch (error) {
      if (signal && signal.aborted) throw cancellationError(signal)
      console.log('[farm] drop collection warning: ' + error.message)
      return { collected, error: error.message }
    }
  }

  return { collected }
}

async function replantCrop(bot, position, definition, signal) {
  throwIfCancelled(signal)

  const farmland = bot.blockAt(position.offset(0, -1, 0))
  const target = bot.blockAt(position)
  if (!farmland || farmland.name !== 'farmland') return false
  if (target && target.type !== 0) {
    return Boolean(
      target.name === definition.block &&
      !isMatureCrop(target, definition)
    )
  }

  const seed = bot.inventory.items()
    .find((item) => item.name === definition.seed && item.count > 0)
  if (!seed) return false

  const eyePosition = bot.entity.position.offset(
    0,
    bot.entity.eyeHeight || 1.62,
    0
  )

  if (eyePosition.distanceTo(position.offset(0.5, 0.5, 0.5)) > 4.5) {
    await bot.pathfinder.goto(
      new goals.GoalNear(position.x, position.y, position.z, 2)
    )
  }

  throwIfCancelled(signal)
  await bot.equip(seed, 'hand')
  throwIfCancelled(signal)

  const up = position.minus(farmland.position)
  await bot.placeBlock(farmland, up)
  throwIfCancelled(signal)

  const planted = bot.blockAt(position)
  return Boolean(planted && planted.name === definition.block)
}

async function farmCrops(
  bot,
  cropName = 'all',
  amount = 1,
  options = {}
) {
  const { signal, maxDistance = 16 } = options
  const crop = resolveCropName(cropName)

  if (!crop) {
    bot.chat(`I do not recognize the crop ${cropName}.`)
    return false
  }

  throwIfCancelled(signal)

  const definitions = getCropDefinitions(crop)
  let matureCrops = findMatureCrops(
    bot,
    definitions,
    amount,
    maxDistance
  )

  if (matureCrops.length === 0) {
    bot.chat(
      crop === 'all'
        ? 'I cannot find any mature crops nearby.'
        : `I cannot find mature ${crop} nearby.`
    )
    return false
  }

  const container = findNearbyContainer(bot)
  const chestLocations = container ? [container.position] : []
  const inventoryIsFull = (
    bot.inventory &&
    typeof bot.inventory.emptySlotCount === 'function' &&
    bot.inventory.emptySlotCount() === 0
  )

  if (inventoryIsFull && chestLocations.length === 0) {
    bot.chat('My inventory is full. Put a chest or barrel nearby, or clear a slot.')
    return false
  }

  let harvested = 0
  let replanted = 0
  const failures = []
  const failedPositions = new Set()

  while (harvested < amount) {
    throwIfCancelled(signal)

    const candidate = matureCrops.find((entry) => (
      !failedPositions.has(positionKey(entry.position))
    ))

    if (!candidate) break

    const block = bot.blockAt(candidate.position)
    if (!isMatureCrop(block, candidate.definition)) {
      failedPositions.add(positionKey(candidate.position))
      matureCrops = findMatureCrops(
        bot,
        definitions,
        amount - harvested,
        maxDistance
      )
      continue
    }

    try {
      const harvestResult = await harvestCropBlock(
        bot,
        candidate.position,
        candidate.definition,
        signal
      )

      if (!harvestResult.harvested) {
        throw new Error(harvestResult.reason || 'the crop was not harvested')
      }

      harvested += 1

      const dropResult = await collectCropDrops(
        bot,
        candidate.position,
        chestLocations,
        candidate.definition.seed,
        signal
      )

      if (dropResult.error) {
        failures.push('drop collection: ' + dropResult.error)
      }

      if (await replantCrop(
        bot,
        candidate.position,
        candidate.definition,
        signal
      )) {
        replanted += 1
      } else {
        failures.push(
          `could not replant ${candidate.definition.crop} at ${candidate.position}`
        )
      }

      console.log(
        `Farmed ${candidate.definition.crop} ` +
        `(${harvested}/${amount}); replanted ${replanted}.`
      )
    } catch (error) {
      if (signal && signal.aborted) throw cancellationError(signal)
      failedPositions.add(positionKey(candidate.position))
      failures.push(error.message)
      console.log(
        `Skipping crop at ${candidate.position}: ${error.message}`
      )
      await cancelFarming(bot)
    }

    // Re-scan after every crop. Mineflayer can reveal more field blocks as Earl
    // walks, and a saved block list becomes stale after harvesting/replanting.
    matureCrops = findMatureCrops(
      bot,
      definitions,
      amount - harvested,
      maxDistance
    )
  }

  if (harvested === 0) {
    bot.chat('I could not harvest any crops.')
    return false
  }

  const cropLabel = crop === 'all' ? 'crops' : crop
  const summary = `Harvested ${harvested} ${cropLabel} and replanted ${replanted}.`
  console.log(summary)
  bot.chat(summary)

  return {
    crop,
    requested: amount,
    harvested,
    replanted,
    complete: harvested >= amount && replanted === harvested,
    failures
  }
}

async function farmAllAvailable(bot, cropName = 'all', options = {}) {
  const { signal, maxDistance = 16 } = options
  const crop = resolveCropName(cropName)

  if (!crop) {
    bot.chat(`I do not recognize the crop ${cropName}.`)
    return false
  }

  throwIfCancelled(signal)
  const status = getFarmStatus(bot, crop, maxDistance)
  const mature = status.crops.reduce(
    (total, entry) => total + entry.mature,
    0
  )

  console.log(`[farm] found ${mature} mature ${crop} within ${maxDistance} blocks.`)

  if (mature === 0) {
    bot.chat(
      crop === 'all'
        ? 'I cannot find any mature crops nearby.'
        : `I cannot find mature ${crop} nearby.`
    )
    return false
  }

  const result = await farmCrops(bot, crop, mature, options)
  return result && {
    ...result,
    availableAtStart: mature,
    farmStatus: status
  }
}

module.exports = farmCrops
module.exports.farmAllAvailable = farmAllAvailable
module.exports.findMatureCrops = findMatureCrops
module.exports.replantCrop = replantCrop
