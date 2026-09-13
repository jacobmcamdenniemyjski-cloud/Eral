const { goals } = require('mineflayer-pathfinder')

async function goTo(bot, x, y, z) {
  const goal = new goals.GoalBlock(x, y, z)
  console.log(`Earl is moving to ${x}, ${y}, ${z}.`)
  await bot.pathfinder.goto(goal)
  console.log(`Earl arrived at ${x}, ${y}, ${z}.`)
}

module.exports = goTo