async function lookAtPlayer(bot, playerName) {
  const player = bot.players[playerName]

  if (!player || !player.entity) {
    console.log(`Player ${playerName} not found.`)
    return
  }

  await bot.lookAt(player.entity.position.offset(0, 1.6, 0))

  console.log(`Earl looked at ${playerName}.`)
}

module.exports = lookAtPlayer