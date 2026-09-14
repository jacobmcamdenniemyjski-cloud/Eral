const { goals } = require('mineflayer-pathfinder')
const withTimeout = require('../scheduler/withTimeout')
const findNearbyContainer = require('../inventory/findNearbyContainer')
const {
  getCropDefinitions,
  isMatureCrop,
  resolveCropName
} = require('./crops')

const COLLECT_TIMEOUT_MS = 45000

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

async function replantCrop(bot, position, definition, signal) {
  throwIfCancelled(signal)

  const farmland = bot.blockAt(position.offset(0, -1, 0))
  const target = bot.blockAt(position)
  if (!farmland || farmland.name !== 'farmland') return false
  if (target && target.type !== 0) return false

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
  const matureCrops = findMatureCrops(
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

  for (const candidate of matureCrops) {
    if (harvested >= amount) break
    throwIfCancelled(signal)

    const block = bot.blockAt(candidate.position)
    if (!isMatureCrop(block, candidate.definition)) continue

    try {
      await withTimeout(
        bot.collectBlock.collect(block, {
          chestLocations,
          itemFilter: seedPreservingFilter(bot, candidate.definition.seed)
        }),
        COLLECT_TIMEOUT_MS,
        `harvesting ${candidate.definition.crop} at ${candidate.position}`,
        { onTimeout: () => cancelFarming(bot) }
      )

      throwIfCancelled(signal)
      harvested += 1

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
      failures.push(error.message)
      console.log(
        `Skipping crop at ${candidate.position}: ${error.message}`
      )
      await cancelFarming(bot)
    }
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

module.exports = farmCrops
module.exports.findMatureCrops = findMatureCrops
module.exports.replantCrop = replantCrop
