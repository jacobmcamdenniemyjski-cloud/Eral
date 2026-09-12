function getNearbyEntities(bot, range = 16) {
  const nearby = []

  for (const entity of Object.values(bot.entities)) {
    if (!entity.position || !bot.entity) continue
    if (entity === bot.entity) continue

    const distance = bot.entity.position.distanceTo(entity.position)

    if (distance <= range) {
      nearby.push({
        id: entity.id,
        name: entity.username || entity.name || entity.displayName || 'unknown',
        type: entity.type,
        distance: Math.round(distance * 10) / 10
      })
    }
  }

  return nearby
}

module.exports = getNearbyEntities