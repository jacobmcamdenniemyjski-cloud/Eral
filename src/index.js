const createBot = require('./core/createBot')
const CommandRouter = require('./core/CommandRouter')
const registerCommands = require('./core/registerCommands')
const TaskScheduler = require('./scheduler/TaskScheduler')
const configureSurvival = require('./survival/configureSurvival')
const OllamaProvider = require('./llm/OllamaProvider')
const OllamaAgent = require('./llm/OllamaAgent')

async function main() {
  const bot = await createBot()
  const scheduler = new TaskScheduler()
  const router = new CommandRouter(bot)

  configureSurvival(bot)
  const runtime = registerCommands(bot, scheduler, router)
  const ollamaProvider = new OllamaProvider({
    host: process.env.EARL_OLLAMA_HOST || 'http://127.0.0.1:11434',
    model: process.env.EARL_OLLAMA_MODEL || 'qwen3:4b',
    numCtx: Number(process.env.EARL_OLLAMA_NUM_CTX) || 8192
  })
  const llmAgent = new OllamaAgent({
    provider: ollamaProvider,
    skillRegistry: runtime.skillRegistry
  })
  runtime.llmAgent = llmAgent

  bot.once('spawn', () => {
    console.log('Earl connected and spawned.')

    llmAgent.getStatus({ timeoutMs: 5000 }).then((status) => {
      if (!status.connected) {
        console.log(`Ollama unavailable: ${status.error}`)
      } else if (!status.modelInstalled) {
        console.log(
          `Ollama connected, but ${status.model} is not installed. ` +
          `Run: ollama pull ${status.model}`
        )
      } else {
        console.log(`Ollama ready with ${status.model}.`)
      }
    })
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
}

main().catch((error) => {
  console.error('Earl failed to start:', error)
  process.exitCode = 1
})
