const createBot = require('./core/createBot')
const followPlayer = require('./movement/followPlayer')
const stopMovement = require('./movement/stopMovement')
const goTo = require('./movement/goTo')

const bot = createBot()

bot.once('spawn', () => {
  console.log('Earl connected and spawned.')
})

bot.on('chat', (username, message) => {
  if (username === bot.username) return

  const text = message.toLowerCase()

  if (text === 'earl follow me') {
    followPlayer(bot, username)
  }

  if (text === 'earl stop') {
    stopMovement(bot)
  }

  if (text.startsWith('earl goto ')) {
    const parts = text.split(' ')

    const x = Number(parts[2])
    const y = Number(parts[3])
    const z = Number(parts[4])

    goTo(bot, x, y, z)
  }
})