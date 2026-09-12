const createBot = require('./core/createBot')
const followPlayer = require('./movement/followPlayer')
const stopMovement = require('./movement/stopMovement')
const goTo = require('./movement/goTo')
const lookAtPlayer = require('./movement/lookAtPlayer')

const findNearestBlock = require('./perception/findNearestBlock')
const getStatus = require('./perception/getStatus')
const getNearbyEntities = require('./perception/getNearbyEntities')

const gatherBlock = require('./gathering/gatherBlock')

const TaskScheduler = require('./scheduler/TaskScheduler')

const bot = createBot()
const scheduler = new TaskScheduler()

bot.once('spawn', () => {
  console.log('Earl connected and spawned.')
})

bot.on('chat', (username, message) => {
  if (username === bot.username) return

  const text = message.toLowerCase()

  if (text.startsWith('earl gather ')) {
    const parts = text.split(' ')

    const blockName = parts[2]
    const amount = Number(parts[3]) || 1

    gatherBlock(bot, blockName, amount)
  }

  if (text === 'earl task') {
    console.log(scheduler.getCurrentTask())
  }

  if (text === 'earl follow me') {
    const accepted = scheduler.setTask({
      type: 'follow',
      target: username,
      priority: 200
    })

    if (accepted) {
      followPlayer(bot, username)
    }
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
    scheduler.clearTask()
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

    const accepted = scheduler.setTask({
      type: 'goto',
      x,
      y,
      z,
      priority: 200
    })

    if (accepted) {
      goTo(bot, x, y, z)
    }
  }
})