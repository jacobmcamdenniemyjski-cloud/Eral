const BANNED_FOOD = [
  'rotten_flesh',
  'spider_eye',
  'poisonous_potato',
  'pufferfish',
  'chorus_fruit',
  'raw_chicken'
]

function configureSurvival(bot) {
  function initializeAutoEat() {
    if (!bot.autoEat) {
      console.error('Automatic eating plugin failed to initialize.')
      return
    }

    bot.autoEat.setOpts({
      priority: 'foodPoints',
      minHunger: 15,
      minHealth: 14,
      returnToLastItem: true,
      offhand: false,
      bannedFood: BANNED_FOOD,
      strictErrors: false
    })

    bot.autoEat.on('eatStart', ({ food }) => {
      console.log(`Earl started eating ${food.name}.`)
    })

    bot.autoEat.on('eatFinish', ({ food }) => {
      console.log(`Earl finished eating ${food.name}.`)
    })

    bot.autoEat.on('eatFail', (error) => {
      console.error(`Automatic eating failed: ${error.message}`)
    })

    bot.autoEat.enableAuto()
  }

  if (bot.autoEat) {
    initializeAutoEat()
  } else {
    bot.once('inject_allowed', initializeAutoEat)
  }

  bot.on('spawn', async () => {
    if (bot.autoEat && !bot.autoEat.enabled) {
      bot.autoEat.enableAuto()
    }

    try {
      await bot.armorManager.equipAll()
    } catch (error) {
      console.error(`Automatic armor equip failed: ${error.message}`)
    }
  })
}

module.exports = configureSurvival
