const mineflayer = require('mineflayer')
const { pathfinder } = require('mineflayer-pathfinder')
const collectBlock = require('mineflayer-collectblock').plugin
const armorManager = require('mineflayer-armor-manager')
const autoEat = require('mineflayer-auto-eat').plugin
const loadPvpPlugin = require('./loadPvpPlugin')

async function createBot() {
  const configuredVersion = process.env.EARL_MC_VERSION || '1.21.11'
  const bot = mineflayer.createBot({
    host: process.env.EARL_MC_HOST || process.env.MC_HOST || 'localhost',
    port: Number(process.env.EARL_MC_PORT || process.env.MC_PORT) || 25565,
    username: process.env.EARL_MC_USERNAME ||
      process.env.MC_USERNAME ||
      'earl',
    auth: process.env.EARL_MC_AUTH || process.env.MC_AUTH || 'offline',
    ...(configuredVersion === 'auto' ? {} : { version: configuredVersion })
  })

  bot.loadPlugin(pathfinder)
  bot.loadPlugin(collectBlock)
  bot.loadPlugin(armorManager)
  bot.loadPlugin(autoEat)
  bot.loadPlugin(loadPvpPlugin)

  return bot
}

module.exports = createBot
