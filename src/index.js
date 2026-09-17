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
const BuildPlanStore = require('./building/BuildPlanStore')
const SurvivalRecovery = require('./survival/SurvivalRecovery')

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

function logFatal(label, error) {
  const detail = error && error.stack ? error.stack : String(error)
  console.error(`[fatal ${new Date().toISOString()}] ${label}: ${detail}`)
}

process.on('uncaughtException', (error) => {
  logFatal('uncaughtException', error)
  process.exit(1)
})

process.on('unhandledRejection', (error) => {
  logFatal('unhandledRejection', error)
  process.exit(1)
})

async function main() {
  const brainMode = getBrainMode()
  const bot = await createBot()
  let shuttingDown = false
  const connectionState = {
    connected: false,
    spawned: false,
    lastEvent: 'created',
    lastEventAt: new Date().toISOString(),
    lastDisconnect: null
  }
  const connectionEvent = (event, details = null) => {
    connectionState.lastEvent = event
    connectionState.lastEventAt = new Date().toISOString()
    if (details !== null) connectionState.details = details
  }

  bot.on('login', () => {
    connectionState.connected = true
    connectionEvent('login')
  })
  bot.on('spawn', () => {
    connectionState.connected = true
    connectionState.spawned = true
    connectionState.lastDisconnect = null
    connectionEvent('spawn')
  })
  bot.on('kicked', (reason) => {
    let detail
    try {
      detail = typeof reason === 'string' ? reason : JSON.stringify(reason)
    } catch {
      detail = String(reason)
    }
    connectionEvent('kicked', detail)
    console.error(`[minecraft ${connectionState.lastEventAt}] kicked: ${detail}`)
  })
  bot.on('error', (error) => {
    connectionEvent('error', error.message)
    console.error(`[minecraft ${connectionState.lastEventAt}] error: ${error.stack || error.message}`)
  })
  bot.on('end', (reason) => {
    connectionState.connected = false
    connectionState.spawned = false
    connectionState.lastDisconnect = {
      time: new Date().toISOString(),
      reason: String(reason || 'connection ended')
    }
    connectionEvent('end', connectionState.lastDisconnect.reason)
    console.error(
      `[minecraft ${connectionState.lastEventAt}] connection ended: ` +
      connectionState.lastDisconnect.reason
    )
    if (!shuttingDown) {
      setTimeout(() => process.exit(1), 100).unref()
    }
  })
  const scheduler = new TaskScheduler()
  const router = new CommandRouter(bot)
  const dataDir = process.env.EARL_DATA_DIR || path.join(process.cwd(), 'data')
  const chatBridge = new ChatBridge({
    filePath: process.env.EARL_BRIDGE_FILE || path.join(dataDir, 'bridge.json')
  })
  const deathTracker = new DeathTracker(bot)
  const buildPlanStore = new BuildPlanStore({
    filePath: process.env.EARL_BUILD_PLANS_FILE ||
      path.join(dataDir, 'build-plans.json')
  })

  bot.on('chat', (username, message) => {
    if (username !== bot.username) {
      chatBridge.recordMessage(username, message)
    }
  })

  deathTracker.start()

  const runtime = registerCommands(bot, scheduler, router, {
    brainMode,
    chatBridge,
    deathTracker,
    buildPlanStore
  })
  configureSurvival(bot, {
    actionCoordinator: runtime.actionCoordinator
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
  runtime.buildPlanStore = buildPlanStore
  runtime.connectionState = connectionState

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
  const survivalRecovery = new SurvivalRecovery(bot, {
    actionCoordinator: runtime.actionCoordinator,
    combatReflex: runtime.combatReflex,
    autonomyController,
    filePath: process.env.EARL_SURVIVAL_FILE ||
      path.join(dataDir, 'survival-recovery.json')
  })
  survivalRecovery.start()
  runtime.survivalRecovery = survivalRecovery
  runtime.skillRegistry.addExecutionGuard(({ name, skill }) => (
    survivalRecovery.guardSkill(name, skill.safety)
  ))
  runtime.skillRegistry.register({
    name: 'get_survival_recovery',
    description: 'Read critical-health and repeated-death recovery state.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    safety: 'read_only',
    execute: async () => survivalRecovery.getStatus()
  })
  runtime.skillRegistry.register({
    name: 'clear_survival_recovery',
    description: 'Player-authorized reset of repeated-death recovery mode after the danger is fixed.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    safety: 'control',
    execute: async () => survivalRecovery.clear()
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

  async function shutdown() {
    if (shuttingDown) return
    shuttingDown = true

    try {
      await taskManager.cancelCurrent('Earl is shutting down.')
    } catch {}
    autonomyController.stop()
    deathTracker.stop()
    survivalRecovery.stop()
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
  // A partially initialized Mineflayer client can otherwise keep running
  // after an API bind/configuration failure and create a ghost second Earl.
  process.exit(1)
})
