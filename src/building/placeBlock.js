const { goals } = require('mineflayer-pathfinder')

const SUPPORT_OFFSETS = [
  [0, -1, 0],
  [0, 0, -1],
  [0, 0, 1],
  [-1, 0, 0],
  [1, 0, 0],
  [0, 1, 0]
]

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

async function placeBlock(bot, blockName, position) {
  const blockType = bot.registry.blocksByName[blockName]
  const itemType = bot.registry.itemsByName[blockName]

  if (!blockType || !itemType) {
    throw new Error(`${blockName} is not a placeable block`)
  }

  const target = toBlockPosition(bot, position)
  const currentBlock = bot.blockAt(target)

  if (!currentBlock) {
    throw new Error(`the target at ${target} is not loaded`)
  }

  if (currentBlock.name === blockName) {
    return { placed: false, skipped: true }
  }

  if (!isReplaceable(currentBlock)) {
    throw new Error(`${target} is occupied by ${currentBlock.name}`)
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

  const supportBlock = findSupportBlock(bot, target)

  if (!supportBlock) {
    throw new Error(`${target} has no adjacent support block`)
  }

  await bot.equip(item, 'hand')

  const faceVector = target.minus(supportBlock.position)
  await bot.placeBlock(supportBlock, faceVector)

  const placedBlock = bot.blockAt(target)

  if (!placedBlock || placedBlock.name !== blockName) {
    throw new Error(`placement at ${target} was not confirmed`)
  }

  return { placed: true, skipped: false }
}

async function buildBlocks(bot, blockName, positions, label) {
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
    const target = toBlockPosition(bot, position)
    const block = bot.blockAt(target)

    if (!block) {
      bot.chat(`I cannot see the build area around ${target}.`)
      return false
    }

    if (block.name === blockName) {
      continue
    }

    if (!isReplaceable(block)) {
      bot.chat(`I cannot build there; ${target} contains ${block.name}.`)
      return false
    }

    required += 1
  }

  const available = getInventoryCount(bot, blockName)

  if (available < required) {
    bot.chat(`I need ${required} ${blockName}, but I only have ${available}.`)
    return false
  }

  let placed = 0

  try {
    for (const position of uniquePositions) {
      const result = await placeBlock(bot, blockName, position)

      if (result.placed) {
        placed += 1
      }
    }

    console.log(`Built ${label} using ${placed} ${blockName}.`)
    bot.chat(`Built ${label} using ${placed} ${blockName}.`)
    return true
  } catch (error) {
    console.error(`Building stopped after ${placed} blocks: ${error.message}`)
    bot.chat(`Building stopped after ${placed} blocks: ${error.message}`)
    return false
  }
}

module.exports = {
  placeBlock,
  buildBlocks
}
