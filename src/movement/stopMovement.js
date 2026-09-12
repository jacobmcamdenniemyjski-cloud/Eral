function stopMovement(bot) {
  bot.pathfinder.setGoal(null)
  console.log('Earl stopped moving.')
}

module.exports = stopMovement
