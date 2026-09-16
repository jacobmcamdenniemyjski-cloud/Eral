const { goals } = require('mineflayer-pathfinder')
const {
  entitiesAtPosition,
  isPositionClearOfEntities
} = require('../perception/isPositionClear')
const { isClearablePlant } = require('./clearBuildSite')
const { breakVegetation } = require('../farming/gatherSeeds')
const {
  inventoryCount,
  waitForBlock,
  waitForCondition
} = require('../actions/verifiedState')

const SUPPORT_OFFSETS = [
  [0, -1, 0],
  [0, 0, -1],
  [0, 0, 1],
  [-1, 0, 0],
  [1, 0, 0],
  [0, 1, 0]
]
const MAX_PLACE_ATTEMPTS = 2
const ALTERNATE_PLACED_NAMES = {
  torch: ['torch', 'wall_torch'],
  soul_torch: ['soul_torch', 'soul_wall_torch'],
  redstone_torch: ['redstone_torch', 'redstone_wall_torch']
}

function throwIfCancelled(signal) {
  if (signal && signal.aborted) {
    throw signal.reason || new Error('Building was cancelled.')
  }
}

function toBlockPosition(bot, position) {
  const origin = bot.entity.position.floored()

  return origin.offset(
    position.x - origin.x,
    position.y - origin.y,
    position.z - origin.z
  )
}

function getInventoryCount(bot, itemName) {
  return bot.inventory.items()
    .filter((item) => item.name === itemName)
    .reduce((total, item) => total + item.count, 0)
}

function isCreative(bot) {
  return String(bot.game && bot.game.gameMode)
    .toLowerCase()
    .includes('creative')
}

function isReplaceable(block) {
  return block && block.boundingBox === 'empty'
}

function findSupportBlock(bot, target) {
  for (const [x, y, z] of SUPPORT_OFFSETS) {
    const block = bot.blockAt(target.offset(x, y, z))

    if (block && block.boundingBox === 'block') {
      return block
    }
  }

  return null
}

function findPlaceablePosition(bot, radius = 4) {
  const origin = bot.entity.position.floored()
  const offsets = []

  for (let x = -radius; x <= radius; x += 1) {
    for (let z = -radius; z <= radius; z += 1) {
      if (x === 0 && z === 0) continue

      offsets.push({
        x,
        z,
        distance: Math.max(Math.abs(x), Math.abs(z))
      })
    }
  }

  offsets.sort((a, b) => a.distance - b.distance)

  for (const offset of offsets) {
    const candidate = origin.offset(offset.x, 0, offset.z)
    const block = bot.blockAt(candidate)

    if (
      block &&
      isReplaceable(block) &&
      isPositionClearOfEntities(bot, candidate) &&
      findSupportBlock(bot, candidate)
    ) {
      return candidate
    }
  }

  return null
}

function isSelf(bot, entity) {
  return entity === bot.entity || (
    entity && bot.entity && entity.id !== undefined && entity.id === bot.entity.id
  )
}

function walkableStandPositions(bot, target, radius = 3) {
  const baseY = Math.floor(bot.entity.position.y)
  const candidates = []

  for (let radiusStep = 1; radiusStep <= radius; radiusStep += 1) {
    for (let x = -radiusStep; x <= radiusStep; x += 1) {
      for (let z = -radiusStep; z <= radiusStep; z += 1) {
        if (Math.max(Math.abs(x), Math.abs(z)) !== radiusStep) continue
        for (const y of [baseY, baseY + 1, baseY - 1]) {
          const feet = target.offset(x, y - target.y, z)
          const footBlock = bot.blockAt(feet)
          const headBlock = bot.blockAt(feet.offset(0, 1, 0))
          const support = bot.blockAt(feet.offset(0, -1, 0))
          if (
            footBlock && isReplaceable(footBlock) &&
            headBlock && isReplaceable(headBlock) &&
            support && support.boundingBox === 'block' &&
            isPositionClearOfEntities(bot, feet)
          ) {
            candidates.push(feet)
          }
        }
      }
    }
  }

  return candidates
}

async function moveSelfOffTarget(bot, target, signal) {
  const blocking = entitiesAtPosition(bot, target)
  if (!blocking.some((entity) => isSelf(bot, entity))) return

  const stand = walkableStandPositions(bot, target)[0]
  if (!stand) {
    throw new Error(`${target} is occupied by Earl and no safe adjacent stand position exists`)
  }

  await bot.pathfinder.goto(new goals.GoalNear(stand.x, stand.y, stand.z, 0))
  throwIfCancelled(signal)
  if (entitiesAtPosition(bot, target).some((entity) => isSelf(bot, entity))) {
    throw new Error(`Earl could not move clear of ${target}`)
  }
}

function acceptablePlacedNames(blockName) {
  return new Set(ALTERNATE_PLACED_NAMES[blockName] || [blockName])
}

async function placeBlock(bot, blockName, position = null, options = {}) {
  const target = position || findPlaceablePosition(bot)

  if (!target) {
    throw new Error(
      `could not find a suitable spot near me to place ${blockName}`
    )
  }

  return placeBlockAt(bot, blockName, target, options)
}

async function placeBlockAt(bot, blockName, position, options = {}) {
  const { signal } = options
  throwIfCancelled(signal)

  const blockType = bot.registry.blocksByName[blockName]
  const itemType = bot.registry.itemsByName[blockName]

  if (!blockType || !itemType) {
    throw new Error(`${blockName} is not a placeable block`)
  }

  const target = toBlockPosition(bot, position)
  let currentBlock = bot.blockAt(target)

  if (!currentBlock) {
    throw new Error(`the target at ${target} is not loaded`)
  }

  if (currentBlock.name === blockName) {
    return { placed: false, skipped: true }
  }

  // Mineflayer reports grass and flowers as replaceable, but servers do not
  // always replace them reliably during placement. Clear and confirm them
  // first so a build cannot silently route around vegetation.
  if (isClearablePlant(currentBlock)) {
    await breakVegetation(bot, currentBlock, signal)
    currentBlock = bot.blockAt(target)
  }

  if (!isReplaceable(currentBlock)) {
    throw new Error(`${target} is occupied by ${currentBlock.name}`)
  }

  await moveSelfOffTarget(bot, target, signal)

  if (!isPositionClearOfEntities(bot, target)) {
    throw new Error(`${target} is occupied by an entity`)
  }

  const item = bot.inventory.items()
    .find((inventoryItem) => inventoryItem.name === blockName)

  if (!item) {
    throw new Error(`I am out of ${blockName}`)
  }

  const eyePosition = bot.entity.position.offset(
    0,
    bot.entity.eyeHeight || 1.62,
    0
  )

  if (eyePosition.distanceTo(target.offset(0.5, 0.5, 0.5)) > 4.5) {
    await bot.pathfinder.goto(
      new goals.GoalNear(target.x, target.y, target.z, 3)
    )
  }

  throwIfCancelled(signal)

  const beforeCount = inventoryCount(bot, blockName)
  const acceptedNames = acceptablePlacedNames(blockName)
  let lastError = null

  for (let attempt = 1; attempt <= MAX_PLACE_ATTEMPTS; attempt += 1) {
    throwIfCancelled(signal)
    const supportBlock = findSupportBlock(bot, target)

    if (!supportBlock) {
      throw new Error(`${target} has no adjacent support block`)
    }

    await bot.equip(item, 'hand')
    throwIfCancelled(signal)
    const equipped = await waitForCondition(bot, () => (
      bot.heldItem && bot.heldItem.name === blockName ? bot.heldItem : null
    ), { signal, ticks: 4 })
    if (!equipped) {
      throw new Error(`could not keep ${blockName} equipped for placement`)
    }

    const faceVector = target.minus(supportBlock.position)
    try {
      await bot.placeBlock(supportBlock, faceVector)
    } catch (error) {
      lastError = error
    }
    throwIfCancelled(signal)

    const placedBlock = await waitForBlock(
      bot,
      target,
      (block) => Boolean(block && acceptedNames.has(block.name)),
      { signal, ticks: 20 }
    )
    const afterCount = inventoryCount(bot, blockName)

    if (placedBlock && acceptedNames.has(placedBlock.name)) {
      return {
        status: 'completed',
        placed: true,
        skipped: false,
        attempts: attempt,
        evidence: {
          requestedBlock: blockName,
          confirmedBlock: placedBlock.name,
          inventoryBefore: beforeCount,
          inventoryAfter: afterCount
        }
      }
    }

    if (!isCreative(bot) && afterCount < beforeCount) {
      const error = new Error(
        `placement at ${target} consumed ${blockName} but no supported block was confirmed`
      )
      error.code = 'PLACEMENT_CONSUMED_UNCONFIRMED'
      throw error
    }

    if (attempt < MAX_PLACE_ATTEMPTS) {
      console.log(
        `[build] retrying ${blockName} at ${target}; no block or inventory change was confirmed.`
      )
    }
  }

  throw lastError || new Error(`placement at ${target} was not confirmed`)
}

async function buildBlocks(
  bot,
  blockName,
  positions,
  label,
  options = {}
) {
  const { signal } = options

  if (
    !bot.registry.blocksByName[blockName] ||
    !bot.registry.itemsByName[blockName]
  ) {
    bot.chat(`${blockName} is not a placeable block.`)
    return false
  }

  const uniquePositions = Array.from(
    new Map(positions.map((position) => [
      `${position.x},${position.y},${position.z}`,
      position
    ])).values()
  )

  let required = 0

  for (const position of uniquePositions) {
    throwIfCancelled(signal)

    const target = toBlockPosition(bot, position)
    const block = bot.blockAt(target)

    if (!block) {
      bot.chat(`I cannot see the build area around ${target}.`)
      return false
    }

    if (block.name === blockName) continue

    if (!isReplaceable(block)) {
      bot.chat(`I cannot build there; ${target} contains ${block.name}.`)
      return false
    }

    if (!isPositionClearOfEntities(bot, target)) {
      bot.chat(`I cannot build there; an entity is at ${target}.`)
      return false
    }

    required += 1
  }

  const available = getInventoryCount(bot, blockName)

  if (available < required && !isCreative(bot)) {
    bot.chat(`I need ${required} ${blockName}, but I only have ${available}.`)
    return false
  }

  let placed = 0

  try {
    for (const position of uniquePositions) {
      throwIfCancelled(signal)

      const result = await placeBlockAt(
        bot,
        blockName,
        position,
        options
      )

      if (result.placed) placed += 1
    }

    console.log(`Built ${label} using ${placed} ${blockName}.`)
    bot.chat(`Built ${label} using ${placed} ${blockName}.`)
    return true
  } catch (error) {
    if (signal && signal.aborted) throw error

    console.error(`Building stopped after ${placed} blocks: ${error.message}`)
    bot.chat(`Building stopped after ${placed} blocks: ${error.message}`)
    return false
  }
}

module.exports = {
  placeBlock,
  placeBlockAt,
  buildBlocks
}
