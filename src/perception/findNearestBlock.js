function findNearestBlock(bot, blockName, maxDistance = 32) {
  const blockType = bot.registry.blocksByName[blockName]

  if (!blockType) {
    return null
  }

  return bot.findBlock({
    matching: blockType.id,
    maxDistance
  })
}

module.exports = findNearestBlock