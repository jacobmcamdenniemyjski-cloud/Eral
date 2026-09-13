const createBot = require('./core/createBot')
const CommandRouter = require('./core/CommandRouter')
const registerCommands = require('./core/registerCommands')

const TaskScheduler = require('./scheduler/TaskScheduler')

const bot = createBot()
const scheduler = new TaskScheduler()
const router = new CommandRouter(bot)

registerCommands(bot, scheduler, router)

bot.once('spawn', () => {
  console.log('Earl connected and spawned.')
})

bot.on('chat', async (username, message) => {
  if (username === bot.username) {
    return
  }

  try {
    await router.handle(username, message)
  } catch (error) {
    console.error('Command failed:', error)
  }
})
