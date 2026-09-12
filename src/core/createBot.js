const mineflayer = require('mineflayer')
const { pathfinder } = require('mineflayer-pathfinder')

function createBot() {
  const bot = mineflayer.createBot({
    host: 'localhost',
    port: 25565,
    username: 'earl',
    auth: 'offline',
    version: '1.21.11'
  })

  bot.loadPlugin(pathfinder)

  return bot
}

module.exports = createBot