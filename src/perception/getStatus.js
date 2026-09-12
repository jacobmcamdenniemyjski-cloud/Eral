function getStatus(bot) {
  return {
    health: bot.health,
    food: bot.food,
    position: {
      x: Math.floor(bot.entity.position.x),
      y: Math.floor(bot.entity.position.y),
      z: Math.floor(bot.entity.position.z)
    }
  }
}

module.exports = getStatus