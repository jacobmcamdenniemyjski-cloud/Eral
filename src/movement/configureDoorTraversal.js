const { Movements } = require('mineflayer-pathfinder')

function configureSafeMovements(bot) {
  if (
    !bot.registry ||
    !bot.pathfinder ||
    typeof bot.pathfinder.setMovements !== 'function'
  ) return null

  const movements = new Movements(bot)
  movements.canDig = false
  // Pathfinder plans through doors while Earl's DoorOpener independently
  // activates, confirms, and retries them before the movement reaches them.
  movements.canOpenDoors = true
  bot.pathfinder.setMovements(movements)
  return movements
}

function ensureDoorOpener(bot) {
  const DoorOpener = require('./DoorOpener')
  bot.earl = bot.earl || {}
  if (!bot.earl.doorOpener) {
    bot.earl.doorOpener = new DoorOpener(bot)
  }
  return bot.earl.doorOpener
}

module.exports = {
  configureSafeMovements,
  ensureDoorOpener
}
