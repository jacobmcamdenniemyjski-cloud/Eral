function isPositionClearOfEntities(bot, blockPos) {
  const blockMinX = blockPos.x
  const blockMaxX = blockPos.x + 1
  const blockMinY = blockPos.y
  const blockMaxY = blockPos.y + 1
  const blockMinZ = blockPos.z
  const blockMaxZ = blockPos.z + 1

  for (const entityId in bot.entities) {
    const entity = bot.entities[entityId]
    if (!entity || !entity.position) continue

    // defaults to player dimensions as fallback
    const width = entity.width || 0.6
    const height = entity.height || 1.8

    const minX = entity.position.x - width / 2
    const maxX = entity.position.x + width / 2
    const minY = entity.position.y
    const maxY = entity.position.y + height
    const minZ = entity.position.z - width / 2
    const maxZ = entity.position.z + width / 2

    const intersectX = minX < blockMaxX && maxX > blockMinX
    const intersectY = minY < blockMaxY && maxY > blockMinY
    const intersectZ = minZ < blockMaxZ && maxZ > blockMinZ

    if (intersectX && intersectY && intersectZ) {
      return false
    }
  }

  return true
}

module.exports = { 
    isPositionClearOfEntities
 }