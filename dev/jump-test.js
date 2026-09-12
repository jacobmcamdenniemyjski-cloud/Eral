const createBot = require('../src/core/createBot')

const bot = createBot()

bot.once('spawn', () => {
  console.log('Earl connected.')

  bot.setControlState('jump', true)

  setTimeout(() => {
    bot.setControlState('jump', false)
    console.log('Earl jumped.')
  }, 500)
})