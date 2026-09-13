const mineflayer = require('mineflayer')
const { pathfinder } = require('mineflayer-pathfinder')
const collectBlock = require('mineflayer-collectblock').plugin
const armorManager = require('mineflayer-armor-manager')
const autoEat = require('mineflayer-auto-eat').plugin
const pvp = require('mineflayer-pvp').plugin

async function createBot() {
  const bot = mineflayer.createBot({
    host: 'localhost',
    port: 25565,
    username: 'earl',
    auth: 'offline',
    version: '1.21.11'
  })

  bot.loadPlugin(pathfinder)
  bot.loadPlugin(collectBlock)
  bot.loadPlugin(armorManager)
  bot.loadPlugin(autoEat)
  bot.loadPlugin(pvp)

  return bot
}

module.exports = createBot
