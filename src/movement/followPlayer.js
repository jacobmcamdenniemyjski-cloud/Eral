const { goals, Movements } = require('mineflayer-pathfinder')

function getPlayerEntity(bot, playerName) {
  const player = bot.players[playerName]
  return player && player.entity ? player.entity : null
}

/**
 * @param {import('mineflayer').Bot} bot
 * @param {string} playerName
 * @param {{ timeoutMs?: number, pollMs?: number }} [options]
 */
async function followPlayer(bot, playerName, { timeoutMs = 5000, pollMs = 200 } = {}) {
  let player = getPlayerEntity(bot, playerName)

  // Right after combat (e.g. creeper knockback throwing Earl away), 
  // the player entity can briefly drop out of tracking range. 
  // Poll for a short window instead of giving up immediately
  const deadline = Date.now() + timeoutMs
  while (!player && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollMs))
    player = getPlayerEntity(bot, playerName)
  }

  if (!player) {
    console.log(`Player ${playerName} not found.`)
    bot.chat(`I can't see ${playerName} right now.`)
    return false
  }

  const movements = new Movements(bot)
  bot.pathfinder.setMovements(movements)

  const goal = new goals.GoalFollow(player, 2)
  bot.pathfinder.setGoal(goal, true)

  console.log(`Earl is now following ${playerName}.`)
  bot.chat(`Following ${playerName}.`)
  return true
}

module.exports = followPlayer