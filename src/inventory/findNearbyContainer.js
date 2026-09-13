const CONTAINER_NAMES = [
  'chest',
  'trapped_chest',
  'barrel'
]

function findNearbyContainer(bot, maxDistance = 16) {
  const containerIds = CONTAINER_NAMES
    .map((name) => bot.registry.blocksByName[name])
    .filter(Boolean)
    .map((block) => block.id)

  if (containerIds.length === 0) {
    return null
  }

  return bot.findBlock({
    matching: containerIds,
    maxDistance
  })
}

module.exports = findNearbyContainer
