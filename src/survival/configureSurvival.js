const BANNED_FOOD = [
  'rotten_flesh',
  'spider_eye',
  'poisonous_potato',
  'pufferfish',
  'chorus_fruit',
  'raw_chicken'
]

function configureSurvival(bot) {
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

  bot.on('spawn', async () => {
    bot.autoEat.enableAuto()

    try {
      await bot.armorManager.equipAll()
    } catch (error) {
      console.error(`Automatic armor equip failed: ${error.message}`)
    }
  })
}

module.exports = configureSurvival
