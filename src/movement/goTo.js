const { goals } = require('mineflayer-pathfinder')

function goTo(bot, x, y, z) {
  const goal = new goals.GoalBlock(x, y, z)

  bot.pathfinder.setGoal(goal)

  console.log(`Earl is moving to ${x}, ${y}, ${z}.`)
}

module.exports = goTo