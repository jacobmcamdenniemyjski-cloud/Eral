const pvp = require('mineflayer-pvp').plugin

function withModernPhysicsTick(bot, plugin) {
  const originalOn = bot.on

  bot.on = function on(eventName, listener) {
    const modernEventName = eventName === 'physicTick'
      ? 'physicsTick'
      : eventName

    return originalOn.call(this, modernEventName, listener)
  }

  try {
    plugin(bot)
  } finally {
    bot.on = originalOn
  }
}

function loadPvpPlugin(bot) {
  withModernPhysicsTick(bot, pvp)
}

module.exports = loadPvpPlugin
module.exports.withModernPhysicsTick = withModernPhysicsTick
