const createBot = require('./core/createBot')
const followPlayer = require('./movement/followPlayer')

const bot = createBot()

bot.once('spawn', () => {
  console.log('Earl connected and spawned.')
})

bot.on('chat', (username, message) => {
  if (username === bot.username) return

  if (message.toLowerCase() === 'earl follow me') {
    followPlayer(bot, username)
  }
})
