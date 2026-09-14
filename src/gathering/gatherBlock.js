const withTimeout = require('../scheduler/withTimeout')
const findNearbyContainer = require('../inventory/findNearbyContainer')

const COLLECT_TIMEOUT_MS = 30000

function cancellationError(signal) {
  const error = signal && signal.reason instanceof Error
    ? signal.reason
    : new Error('Gathering was cancelled.')

  error.code = error.code || 'ACTION_CANCELLED'
  return error
}

function throwIfCancelled(signal) {
  if (signal && signal.aborted) {
    throw cancellationError(signal)
  }
}

async function cancelCollecting(bot) {
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

async function ensureToolEquipped(bot, blockType, blockName) {
  const validToolIds = Object.keys(blockType.harvestTools || {})
    .map(Number)

  if (validToolIds.length === 0) return true

  if (bot.heldItem && validToolIds.includes(bot.heldItem.type)) {
    return true
  }

  const tool = bot.inventory.items()
    .find((item) => validToolIds.includes(item.type))

  if (!tool) {
    console.log(`Cannot gather ${blockName}: no valid tool in inventory.`)
    bot.chat(`I need a proper tool to gather ${blockName}.`)
    return false
  }

  await bot.equip(tool, 'hand')
  return true
}

async function gatherBlock(bot, blockName, amount = 1, options = {}) {
  const { signal } = options
  const blockType = bot.registry.blocksByName[blockName]

  if (!blockType) {
    console.log(`Unknown block: ${blockName}`)
    bot.chat(`I do not recognize the block ${blockName}.`)
    return false
  }

  throwIfCancelled(signal)

  const canProceed = await ensureToolEquipped(
    bot,
    blockType,
    blockName
  )

  if (!canProceed) return false

  const candidateCount = Math.min(Math.max(amount * 3, amount), 192)
  const positions = bot.findBlocks({
    matching: blockType.id,
    maxDistance: 32,
    count: candidateCount
  })

  if (positions.length === 0) {
    console.log(`No ${blockName} found nearby.`)
    bot.chat(`I cannot find ${blockName} nearby.`)
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
    console.log(`Cannot gather ${blockName}: inventory is full and no nearby container exists.`)
    bot.chat('My inventory is full. Put a chest or barrel within 16 blocks, or clear a slot.')
    return false
  }

  if (inventoryIsFull) {
    console.log(`Inventory full; using nearby ${container.name} while gathering.`)
    bot.chat(`My inventory is full, so I will use the nearby ${container.name}.`)
  }

  let collected = 0
  let inventoryBlocked = false

  for (const position of positions) {
    if (collected >= amount) break
    throwIfCancelled(signal)

    const block = bot.blockAt(position)
    if (!block || block.type !== blockType.id) continue

    try {
      await withTimeout(
        bot.collectBlock.collect(block, { chestLocations }),
        COLLECT_TIMEOUT_MS,
        `collecting ${blockName} at ${position.x},${position.y},${position.z}`,
        {
          onTimeout: () => cancelCollecting(bot)
        }
      )

      throwIfCancelled(signal)
      collected += 1
      console.log(`Collected ${blockName} (${collected}/${amount}).`)
    } catch (error) {
      if (signal && signal.aborted) {
        throw cancellationError(signal)
      }

      if (/no defined chest locations/i.test(error.message)) {
        inventoryBlocked = true
        console.log(
          `Cannot continue gathering ${blockName}: inventory became full and no nearby container exists.`
        )
        bot.chat(
          'My inventory became full. Put a chest or barrel within 16 blocks, or clear a slot.'
        )
        await cancelCollecting(bot)
        break
      }

      console.log(
        `Skipping ${blockName} at ${position.x},${position.y},${position.z}: ${error.message}`
      )

      await cancelCollecting(bot)
    }
  }

  if (inventoryBlocked) return false

  if (collected === 0) {
    console.log(`Could not collect any ${blockName}.`)
    bot.chat(`I could not collect any ${blockName}.`)
    return false
  }

  if (collected < amount) {
    bot.chat(`I collected ${collected} of ${amount} ${blockName}.`)
    return false
  }

  console.log(`Collected ${collected} ${blockName}.`)
  return true
}

module.exports = gatherBlock
