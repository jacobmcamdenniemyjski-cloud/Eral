const CONTAINER_NAMES = [
  'chest',
  'trapped_chest',
  'barrel'
]

function findNearbyContainer(bot, maxDistance = 16) {
  if (typeof bot.findBlock === 'function') {
    const containerIds = containerTypeIds(bot)
    if (containerIds.length === 0) return null
    return bot.findBlock({ matching: containerIds, maxDistance })
  }
  return findNearbyContainers(bot, maxDistance, 1)[0] || null
}

function containerTypeIds(bot) {
  return CONTAINER_NAMES
    .map((name) => bot.registry.blocksByName[name])
    .filter(Boolean)
    .map((block) => block.id)
}

function findNearbyContainers(bot, maxDistance = 16, count = 16) {
  const containerIds = containerTypeIds(bot)

  if (containerIds.length === 0) {
    return []
  }

  if (typeof bot.findBlocks !== 'function') {
    const found = typeof bot.findBlock === 'function'
      ? bot.findBlock({ matching: containerIds, maxDistance })
      : null
    return found ? [found] : []
  }
  const positions = bot.findBlocks({
    matching: containerIds,
    maxDistance,
    count
  })
  return positions
    .map((position) => bot.blockAt(position))
    .filter(Boolean)
    .sort((a, b) => (
      bot.entity.position.distanceTo(a.position) -
      bot.entity.position.distanceTo(b.position)
    ))
}

module.exports = findNearbyContainer
module.exports.findNearbyContainers = findNearbyContainers
