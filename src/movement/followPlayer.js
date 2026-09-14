const { goals, Movements } = require('mineflayer-pathfinder')
const DoorOpener = require('./DoorOpener')

function getPlayerEntity(bot, playerName) {
  const player = bot.players[playerName]
  return player && player.entity ? player.entity : null
}

async function followPlayer(bot, playerName, { timeoutMs = 5000, pollMs = 200 } = {}) {
  let player = getPlayerEntity(bot, playerName)
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
  movements.canDig = false
  movements.canOpenDoors = false
  bot.pathfinder.setMovements(movements)

  bot.earl = bot.earl || {}
  const replanAfterDoor = () => {
    const currentGoal = bot.pathfinder.goal
    if (currentGoal) bot.pathfinder.setGoal(currentGoal, true)
  }

  if (!bot.earl.doorOpener) {
    bot.earl.doorOpener = new DoorOpener(bot, {
      onOpened: replanAfterDoor
    })
  } else {
    bot.earl.doorOpener.onOpened = replanAfterDoor
  }
  bot.earl.doorOpener.start()

  bot.pathfinder.setGoal(new goals.GoalFollow(player, 2), true)
  console.log(`Earl is now following ${playerName}.`)
  bot.chat(`Following ${playerName}.`)
  return true
}

module.exports = followPlayer
