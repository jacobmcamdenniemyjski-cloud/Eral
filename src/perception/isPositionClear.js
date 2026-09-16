function entitiesAtPosition(bot, blockPosition) {
  const blockMaxX = blockPosition.x + 1
  const blockMaxY = blockPosition.y + 1
  const blockMaxZ = blockPosition.z + 1

  const candidates = [...Object.values(bot.entities || {})]
  if (bot.entity && !candidates.includes(bot.entity)) candidates.push(bot.entity)
  const blocking = []

  for (const entity of candidates) {
    if (!entity || !entity.position) continue

    const width = entity.width || 0.6
    const height = entity.height || 1.8
    const entityMinX = entity.position.x - width / 2
    const entityMaxX = entity.position.x + width / 2
    const entityMinY = entity.position.y
    const entityMaxY = entity.position.y + height
    const entityMinZ = entity.position.z - width / 2
    const entityMaxZ = entity.position.z + width / 2

    const intersects =
      entityMinX < blockMaxX &&
      entityMaxX > blockPosition.x &&
      entityMinY < blockMaxY &&
      entityMaxY > blockPosition.y &&
      entityMinZ < blockMaxZ &&
      entityMaxZ > blockPosition.z

    if (intersects) blocking.push(entity)
  }

  return blocking
}

function isPositionClearOfEntities(bot, blockPosition) {
  return entitiesAtPosition(bot, blockPosition).length === 0
}

module.exports = { entitiesAtPosition, isPositionClearOfEntities }
