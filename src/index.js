const createBot = require('./core/createBot')
const followPlayer = require('./movement/followPlayer')
const stopMovement = require('./movement/stopMovement')
const goTo = require('./movement/goTo')
const lookAtPlayer = require('./movement/lookAtPlayer')
const findNearestBlock = require('./perception/findNearestBlock')

const getStatus = require('./perception/getStatus')
const getNearbyEntities = require('./perception/getNearbyEntities')

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

  if (text.startsWith('earl find ')) {
    const blockName = text.replace('earl find ', '').trim()
    const block = findNearestBlock(bot, blockName)

    if (block) {
      console.log({
        name: block.name,
        position: block.position
      })
    } else {
      console.log(`No ${blockName} found nearby.`)
    }
  }

  if (text === 'earl stop') {
    stopMovement(bot)
  }

  if (text === 'earl look at me') {
    lookAtPlayer(bot, username)
  }

  if (text === 'earl status') {
    console.log(getStatus(bot))
  }

  if (text === 'earl scan') {
    console.log(getNearbyEntities(bot))
  }

  if (text.startsWith('earl goto ')) {
    const parts = text.split(' ')

    const x = Number(parts[2])
    const y = Number(parts[3])
    const z = Number(parts[4])

    goTo(bot, x, y, z)
  }
})