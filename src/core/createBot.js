const mineflayer = require('mineflayer')
const { pathfinder } = require('mineflayer-pathfinder')
const collectBlock = require('mineflayer-collectblock').plugin

function createBot() {
  const bot = mineflayer.createBot({
    host: 'localhost',
    port: 25565,
    username: 'earl',
    auth: 'offline',
    version: '1.21.11'
  })

  bot.loadPlugin(pathfinder)
  bot.loadPlugin(collectBlock)
  return bot
}

module.exports = createBot