const createBot = require('./core/createBot')

const bot = createBot()

bot.once('spawn', () => {
  console.log('Earl connected and spawned.')
})