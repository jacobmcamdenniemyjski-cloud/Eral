const path = require('node:path')
const createBot = require('./core/createBot')
const CommandRouter = require('./core/CommandRouter')
const registerCommands = require('./core/registerCommands')
const TaskScheduler = require('./scheduler/TaskScheduler')
const configureSurvival = require('./survival/configureSurvival')
const OllamaProvider = require('./llm/OllamaProvider')
const OllamaAgent = require('./llm/OllamaAgent')
const ChatBridge = require('./bridge/ChatBridge')
const TaskManager = require('./bridge/TaskManager')
const DeathTracker = require('./bridge/DeathTracker')
const EarlApiServer = require('./api/EarlApiServer')
const LearnedProcedureStore = require('./learning/LearnedProcedureStore')
const AutonomyController = require('./autonomy/AutonomyController')

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

function getBrainMode() {
  const mode = String(process.env.EARL_BRAIN || 'ollama').toLowerCase()
  if (!['ollama', 'hermes', 'none'].includes(mode)) {
    throw new Error('EARL_BRAIN must be ollama, hermes, or none.')
  }
  return mode
}

function isLoopback(host) {
  return ['127.0.0.1', '::1', 'localhost'].includes(host)
}

async function main() {
  const brainMode = getBrainMode()
  const bot = await createBot()
  const scheduler = new TaskScheduler()
  const router = new CommandRouter(bot)
  const dataDir = process.env.EARL_DATA_DIR || path.join(process.cwd(), 'data')
  const chatBridge = new ChatBridge({
    filePath: process.env.EARL_BRIDGE_FILE || path.join(dataDir, 'bridge.json')
  })
  const deathTracker = new DeathTracker(bot)

  bot.on('chat', (username, message) => {
    if (username !== bot.username) {
      chatBridge.recordMessage(username, message)
    }
  })

  configureSurvival(bot)
  deathTracker.start()

  const runtime = registerCommands(bot, scheduler, router, {
    brainMode,
    chatBridge,
    deathTracker
  })
  const taskManager = new TaskManager({
    skillRegistry: runtime.skillRegistry,
    cancelActiveWork: runtime.cancelActiveWork,
    filePath: process.env.EARL_TASKS_FILE || path.join(dataDir, 'tasks.json')
  })
  const procedureStore = new LearnedProcedureStore({
    skillRegistry: runtime.skillRegistry,
    filePath: process.env.EARL_PROCEDURES_FILE ||
      path.join(dataDir, 'procedures.json')
  })
  runtime.taskManager = taskManager
  runtime.procedureStore = procedureStore

  const autonomyController = new AutonomyController({
    bot,
    chatBridge,
    taskManager,
    skillRegistry: runtime.skillRegistry,
    combatReflex: runtime.combatReflex,
    cancelActiveWork: runtime.cancelActiveWork,
    isBusy: () => Boolean(runtime.commandQueue.activeRun),
    enabled: envEnabled(process.env.EARL_AUTONOMY_ENABLED),
    intervalMs: Number(process.env.EARL_AUTONOMY_INTERVAL_MS) || 30000,
    minimumIntentIntervalMs: Number(
      process.env.EARL_AUTONOMY_MIN_INTENT_INTERVAL_MS
    ) || 120000,
    filePath: process.env.EARL_AUTONOMY_FILE ||
      path.join(dataDir, 'autonomy.json')
  })
  runtime.autonomyController = autonomyController
  runtime.combatReflex.setUrgencyHandler(async (active, reason) => {
    if (active) await autonomyController.interrupt(reason)
    else await autonomyController.resume(`${reason} cleared`)
  })

  let llmAgent = null
  if (brainMode === 'ollama') {
    const ollamaProvider = new OllamaProvider({
      host: process.env.EARL_OLLAMA_HOST || 'http://127.0.0.1:11434',
      model: process.env.EARL_OLLAMA_MODEL || 'qwen3:4b-instruct',
      numCtx: Number(process.env.EARL_OLLAMA_NUM_CTX) || 4096,
      think: parseThinkSetting(process.env.EARL_OLLAMA_THINK)
    })
    llmAgent = new OllamaAgent({
      provider: ollamaProvider,
      skillRegistry: runtime.skillRegistry,
      debug: envEnabled(process.env.EARL_LLM_DEBUG),
      conversationNumCtx: Number(process.env.EARL_OLLAMA_CHAT_NUM_CTX) || 2048,
      conversationNumPredict: Number(
        process.env.EARL_OLLAMA_CHAT_NUM_PREDICT
      ) || 128
    })
    runtime.llmAgent = llmAgent
  }

  const apiEnabled = brainMode === 'hermes' ||
    envEnabled(process.env.EARL_API_ENABLED)
  let apiServer = null

  if (apiEnabled) {
    const host = process.env.EARL_API_HOST || '127.0.0.1'
    const token = process.env.EARL_API_TOKEN || ''
    if (!isLoopback(host) && !token) {
      throw new Error(
        'EARL_API_TOKEN is required when the API is not bound to localhost.'
      )
    }

    apiServer = new EarlApiServer({
      bot,
      runtime,
      chatBridge,
      taskManager,
      procedureStore,
      deathTracker,
      autonomyController,
      brainMode,
      host,
      port: Number(process.env.EARL_API_PORT) || 3001,
      token
    })
    const address = await apiServer.start()
    runtime.apiServer = apiServer
    console.log(
      `Earl body API listening on http://${address.host}:${address.port}.`
    )
  }

  bot.once('spawn', () => {
    console.log(`Earl connected and spawned using ${brainMode} brain mode.`)
    autonomyController.start()

    if (autonomyController.getStatus().enabled) {
      console.log('Earl autonomous life controller is enabled.')
    }

    if (llmAgent) {
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
    }
  })

  bot.on('chat', async (username, message) => {
    if (username === bot.username) return

    try {
      await router.handle(username, message)
    } catch (error) {
      console.error('Command failed:', error)
    }
  })

  let shuttingDown = false
  async function shutdown() {
    if (shuttingDown) return
    shuttingDown = true

    try {
      await taskManager.cancelCurrent('Earl is shutting down.')
    } catch {}
    autonomyController.stop()
    deathTracker.stop()
    if (apiServer) await apiServer.stop()
    try {
      bot.quit('Earl is shutting down.')
    } catch {}
  }

  process.once('SIGINT', () => {
    void shutdown().finally(() => process.exit(0))
  })
  process.once('SIGTERM', () => {
    void shutdown().finally(() => process.exit(0))
  })
}

main().catch((error) => {
  console.error('Earl failed to start:', error)
  process.exitCode = 1
})
