function stopMovement(bot) {
  if (bot.earl && bot.earl.doorOpener) bot.earl.doorOpener.stop()
  bot.pathfinder.setGoal(null)
  console.log('Earl stopped moving.')
}

module.exports = stopMovement
