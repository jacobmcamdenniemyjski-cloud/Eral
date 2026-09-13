const createBot = require('./core/createBot')
const CommandRouter = require('./core/CommandRouter')
const registerCommands = require('./core/registerCommands')
const TaskScheduler = require('./scheduler/TaskScheduler')
const configureSurvival = require('./survival/configureSurvival')
const OllamaProvider = require('./llm/OllamaProvider')
const OllamaAgent = require('./llm/OllamaAgent')

function envEnabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(
    String(value || '').trim().toLowerCase()
  )
}

function parseThinkSetting(value) {
  if (value === undefined || value === '') return undefined
  if (String(value).toLowerCase() === 'true') return true
  if (String(value).toLowerCase() === 'false') return false
  return String(value).toLowerCase()
}

async function main() {
  const bot = await createBot()
  const scheduler = new TaskScheduler()
  const router = new CommandRouter(bot)

  configureSurvival(bot)
  const runtime = registerCommands(bot, scheduler, router)
  const ollamaProvider = new OllamaProvider({
    host: process.env.EARL_OLLAMA_HOST || 'http://127.0.0.1:11434',
    model: process.env.EARL_OLLAMA_MODEL || 'qwen3:4b',
    numCtx: Number(process.env.EARL_OLLAMA_NUM_CTX) || 4096,
    think: parseThinkSetting(process.env.EARL_OLLAMA_THINK)
  })
  const llmAgent = new OllamaAgent({
    provider: ollamaProvider,
    skillRegistry: runtime.skillRegistry,
    debug: envEnabled(process.env.EARL_LLM_DEBUG),
    conversationNumCtx: Number(process.env.EARL_OLLAMA_CHAT_NUM_CTX) || 2048,
    conversationNumPredict: Number(
      process.env.EARL_OLLAMA_CHAT_NUM_PREDICT
    ) || 128
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
