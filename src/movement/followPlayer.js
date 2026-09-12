const { goals, Movements } = require('mineflayer-pathfinder')

function followPlayer(bot, playerName) {
  const player = bot.players[playerName]

  if (!player || !player.entity) {
    console.log(`Player ${playerName} not found.`)
    return
  }

  const movements = new Movements(bot)
  bot.pathfinder.setMovements(movements)

  const goal = new goals.GoalFollow(player.entity, 2)
  bot.pathfinder.setGoal(goal, true)

  console.log(`Earl is now following ${playerName}.`)
}

module.exports = followPlayer