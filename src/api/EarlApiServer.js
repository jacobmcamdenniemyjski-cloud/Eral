const http = require('node:http')
const { URL } = require('node:url')

const ACTION_ALIASES = {
  collect: {
    skill: 'gather_block',
    input: (body) => ({
      block: body.block || body.item,
      amount: body.amount || body.count || 1
    })
  },
  craft: {
    skill: 'make_item',
    input: (body) => ({
      item: body.item,
      amount: body.amount || body.count || 1
    })
  },
  eat: { skill: 'eat_now' },
  fight: {
    skill: 'attack_hostile',
    input: (body) => ({
      mob: body.mob || body.target || 'zombie',
      maxDistance: body.maxDistance || 16
    })
  },
  flee: {
    skill: 'flee_from_hostiles',
    input: (body) => ({ distance: body.distance || 16 })
  },
  follow: {
    skill: 'follow_player',
    input: (body) => ({ player: body.player })
  },
  go_mark: {
    skill: 'go_to_location',
    input: (body) => ({ name: body.name })
  },
  goto: {
    skill: 'go_to',
    input: (body) => ({ x: body.x, y: body.y, z: body.z })
  },
  mark: {
    skill: 'mark_location',
    input: (body) => ({ name: body.name })
  },
  pickup: {
    skill: 'pickup_items',
    input: (body) => ({
      maxDistance: body.maxDistance || body.range || 16,
      maxItems: body.maxItems || body.count || 16
    })
  },
  recipes: {
    skill: 'get_recipes',
    input: (body) => ({ item: body.item })
  },
  sleep: { skill: 'sleep_in_bed' },
  sleep_bed: { skill: 'sleep_in_bed' },
  unmark: {
    skill: 'forget_location',
    input: (body) => ({ name: body.name })
  },
  use: {
    skill: 'use_nearby_block',
    input: (body) => ({
      block: body.block,
      maxDistance: body.maxDistance || 16
    })
  }
}

function respond(response, statusCode, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  })
  response.end(body)
}

function errorPayload(error, code = 'API_ERROR') {
  return {
    ok: false,
    error: {
      code: error.code || code,
      message: error.message || String(error)
    }
  }
}

async function readJson(request, maxBytes = 65536) {
  let body = ''
  for await (const chunk of request) {
    body += chunk
    if (Buffer.byteLength(body) > maxBytes) {
      const error = new Error('Request body exceeds 64 KiB.')
      error.code = 'BODY_TOO_LARGE'
      throw error
    }
  }

  if (!body.trim()) return {}
  try {
    return JSON.parse(body)
  } catch {
    const error = new Error('Request body must be valid JSON.')
    error.code = 'INVALID_JSON'
    throw error
  }
}

function boundedNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value)
  const safe = Number.isFinite(parsed) ? parsed : fallback
  return Math.min(Math.max(safe, minimum), maximum)
}

function resultStatus(result) {
  if (result.ok) return 200
  if (
    result.error &&
    ['UNKNOWN_SKILL', 'INVALID_ARGUMENTS'].includes(result.error.code)
  ) {
    return 400
  }
  return 422
}

class EarlApiServer {
  constructor(options) {
    this.bot = options.bot
    this.runtime = options.runtime
    this.chatBridge = options.chatBridge
    this.taskManager = options.taskManager
    this.procedureStore = options.procedureStore ||
      options.runtime.procedureStore || null
    this.deathTracker = options.deathTracker
    this.autonomyController = options.autonomyController ||
      options.runtime.autonomyController || null
    this.host = options.host || '127.0.0.1'
    this.port = options.port === undefined ? 3001 : Number(options.port)
    this.token = options.token || ''
    this.brainMode = options.brainMode || 'hermes'
    this.server = null
  }

  isAuthorized(request, path) {
    if (!this.token || path === '/health') return true
    const bearer = request.headers.authorization || ''
    const headerToken = request.headers['x-earl-token'] || ''
    return bearer === `Bearer ${this.token}` || headerToken === this.token
  }

  async executeSkill(skill, input, requestedBy = 'hermes') {
    return this.runtime.skillRegistry.execute(skill, input || {}, {
      requestedBy,
      cancelActiveWork: this.runtime.cancelActiveWork
    })
  }

  aliasAction(action, body) {
    const alias = ACTION_ALIASES[action]
    if (!alias) return null
    return {
      skill: alias.skill,
      input: alias.input ? alias.input(body) : {}
    }
  }

  async handleGet(path, url, response) {
    if (path === '/health' || path === '/') {
      return respond(response, 200, {
        ok: true,
        data: {
          apiVersion: 1,
          connected: Boolean(this.bot.entity),
          username: this.bot.username,
          minecraftVersion: this.bot.version || null,
          brainMode: this.brainMode,
          bridge: this.chatBridge.summary(),
          tasks: this.taskManager.recoverySummary
            ? this.taskManager.recoverySummary()
            : null,
          autonomy: this.autonomyController
            ? this.autonomyController.getStatus()
            : null,
          actions: this.runtime.actionCoordinator
            ? this.runtime.actionCoordinator.getStatus()
            : null,
          buildPlans: this.runtime.buildPlanStore
            ? this.runtime.buildPlanStore.summary()
            : null,
          survival: this.runtime.survivalRecovery
            ? this.runtime.survivalRecovery.getStatus()
            : null
        }
      })
    }

    if (path === '/skills') {
      return respond(response, 200, {
        ok: true,
        data: this.runtime.skillRegistry.list()
      })
    }

    if (path === '/autonomy') {
      return respond(response, 200, {
        ok: true,
        data: this.autonomyController
          ? this.autonomyController.getStatus()
          : null
      })
    }

    if (path === '/actions') {
      return respond(response, 200, {
        ok: true,
        data: this.runtime.actionCoordinator
          ? this.runtime.actionCoordinator.getStatus()
          : null
      })
    }

    if (path === '/build-plans') {
      return respond(response, 200, {
        ok: true,
        data: this.runtime.buildPlanStore
          ? this.runtime.buildPlanStore.list({
              status: url.searchParams.get('status') || 'all'
            })
          : []
      })
    }

    if (path === '/autonomy/candidates') {
      if (!this.autonomyController) {
        return respond(response, 501, errorPayload(
          new Error('Autonomy is not configured.'),
          'NOT_CONFIGURED'
        ))
      }
      const snapshot = await this.autonomyController.observe()
      return respond(response, 200, {
        ok: true,
        data: this.autonomyController.generateCandidates(snapshot)
      })
    }

    const readSkills = {
      '/status': ['get_status', {}],
      '/inventory': ['get_inventory', {}],
      '/locations': ['get_saved_locations', {}],
      '/deaths': ['get_deaths', {}]
    }
    if (readSkills[path]) {
      const [skill, input] = readSkills[path]
      const result = await this.executeSkill(skill, input)
      return respond(response, resultStatus(result), result)
    }

    if (path === '/nearby') {
      const range = boundedNumber(
        url.searchParams.get('range'),
        16,
        1,
        64
      )
      const result = await this.executeSkill('scan_nearby', { range })
      return respond(response, resultStatus(result), result)
    }

    if (path === '/scene') {
      const range = boundedNumber(
        url.searchParams.get('range'),
        16,
        4,
        32
      )
      const result = await this.executeSkill('get_scene', { range })
      return respond(response, resultStatus(result), result)
    }

    if (path === '/chat') {
      return respond(response, 200, {
        ok: true,
        data: this.chatBridge.getMessages({
          after: url.searchParams.get('after'),
          limit: url.searchParams.get('limit')
        })
      })
    }

    if (path === '/commands/wait') {
      const timeoutMs = boundedNumber(
        url.searchParams.get('timeout'),
        25,
        0.1,
        30
      ) * 1000
      return respond(response, 200, {
        ok: true,
        data: await this.chatBridge.waitForCommands({
          status: 'pending',
          limit: url.searchParams.get('limit'),
          timeoutMs
        })
      })
    }

    if (path === '/commands') {
      return respond(response, 200, {
        ok: true,
        data: this.chatBridge.getCommands({
          status: url.searchParams.get('status') || 'pending',
          limit: url.searchParams.get('limit')
        })
      })
    }

    if (path === '/procedures') {
      if (!this.procedureStore) {
        return respond(response, 501, errorPayload(
          new Error('Learned procedures are not configured.'),
          'NOT_CONFIGURED'
        ))
      }
      return respond(response, 200, {
        ok: true,
        data: this.procedureStore.list({
          status: url.searchParams.get('status') || 'all'
        })
      })
    }

    const procedureMatch = path.match(/^\/procedures\/(\d+)$/)
    if (procedureMatch) {
      const procedure = this.procedureStore &&
        this.procedureStore.find(procedureMatch[1])
      return respond(
        response,
        procedure ? 200 : 404,
        procedure
          ? { ok: true, data: procedure }
          : errorPayload(new Error('Procedure not found.'), 'NOT_FOUND')
      )
    }

    if (path === '/tasks') {
      return respond(response, 200, {
        ok: true,
        data: {
          current: this.taskManager.getCurrent(),
          history: this.taskManager.list()
        }
      })
    }

    if (path === '/task') {
      return respond(response, 200, {
        ok: true,
        data: this.taskManager.getCurrent()
      })
    }

    const taskMatch = path.match(/^\/tasks\/(\d+)$/)
    if (taskMatch) {
      const task = this.taskManager.get(taskMatch[1])
      return respond(
        response,
        task ? 200 : 404,
        task
          ? { ok: true, data: task }
          : errorPayload(new Error('Task not found.'), 'NOT_FOUND')
      )
    }

    return respond(
      response,
      404,
      errorPayload(new Error('Endpoint not found.'), 'NOT_FOUND')
    )
  }

  async handlePost(path, request, response) {
    const body = await readJson(request)

    const autonomyAction = path.match(
      /^\/autonomy\/(enable|disable|tick|interrupt|resume)$/
    )
    if (autonomyAction) {
      if (!this.autonomyController) {
        return respond(response, 501, errorPayload(
          new Error('Autonomy is not configured.'),
          'NOT_CONFIGURED'
        ))
      }

      const action = autonomyAction[1]
      const data = action === 'enable'
        ? this.autonomyController.setEnabled(true)
        : action === 'disable'
          ? this.autonomyController.setEnabled(false)
          : action === 'tick'
            ? await this.autonomyController.tick()
            : action === 'interrupt'
              ? await this.autonomyController.interrupt(
                  body.reason || 'manual interruption'
                )
              : await this.autonomyController.resume(
                  body.reason || 'manual resume'
                )
      return respond(response, 200, { ok: true, data })
    }

    if (path === '/execute') {
      const skill = String(body.skill || '')
      const input = body.input || {}
      if (!skill) {
        return respond(
          response,
          400,
          errorPayload(new Error('skill is required.'), 'INVALID_REQUEST')
        )
      }

      if (body.background) {
        const task = this.taskManager.start(skill, input, {
          requestedBy: body.requestedBy || 'hermes'
        })
        return respond(response, 202, { ok: true, data: task })
      }

      const result = await this.executeSkill(
        skill,
        input,
        body.requestedBy || 'hermes'
      )
      return respond(response, resultStatus(result), result)
    }

    if (path === '/action/chat') {
      const message = String(body.message || '').trim()
      if (!message) {
        return respond(
          response,
          400,
          errorPayload(new Error('message is required.'), 'INVALID_REQUEST')
        )
      }
      this.bot.chat(message.slice(0, 240))
      return respond(response, 200, { ok: true, data: { sent: true } })
    }

    if (path === '/cancel' || path === '/action/stop' || path === '/task/cancel') {
      const task = await this.taskManager.cancelCurrent('stopped by Hermes')
      await this.runtime.cancelActiveWork('stopped by Hermes')
      return respond(response, 200, {
        ok: true,
        data: { stopped: true, task }
      })
    }

    if (path === '/procedures/stage') {
      if (!this.procedureStore) {
        return respond(response, 501, errorPayload(
          new Error('Learned procedures are not configured.'),
          'NOT_CONFIGURED'
        ))
      }
      const procedure = this.procedureStore.stage(body.definition || body)
      return respond(response, 201, { ok: true, data: procedure })
    }

    const procedureAction = path.match(
      /^\/procedures\/(\d+)\/(approve|reject|execute)$/
    )
    if (procedureAction) {
      if (!this.procedureStore) {
        return respond(response, 501, errorPayload(
          new Error('Learned procedures are not configured.'),
          'NOT_CONFIGURED'
        ))
      }
      const [, id, action] = procedureAction
      const data = action === 'approve'
        ? this.procedureStore.approve(id, body.reviewedBy || 'player')
        : action === 'reject'
          ? this.procedureStore.reject(
              id,
              body.reason || 'rejected by player',
              body.reviewedBy || 'player'
            )
          : await this.procedureStore.execute(id, {
              requestedBy: body.requestedBy || 'hermes',
              cancelActiveWork: this.runtime.cancelActiveWork
            })
      return respond(
        response,
        action === 'execute' && data.ok === false ? 422 : 200,
        { ok: action === 'execute' ? data.ok : true, data }
      )
    }

    const taskCancel = path.match(/^\/tasks\/(\d+)\/cancel$/)
    if (taskCancel) {
      const task = await this.taskManager.cancel(
        taskCancel[1],
        body.reason || 'cancelled by Hermes'
      )
      return respond(response, 200, { ok: true, data: task })
    }

    const commandAction = path.match(
      /^\/commands\/(\d+)\/(claim|complete|fail|resume)$/
    )
    if (commandAction) {
      const [, id, action] = commandAction
      const entry = action === 'claim'
        ? this.chatBridge.claimCommand(id)
        : action === 'complete'
          ? this.chatBridge.completeCommand(id, body.result || null)
          : action === 'resume'
            ? this.chatBridge.resumeCommand(id, {
                prefix: body.prefix || 'Resume this recovered request safely: '
              })
            : this.chatBridge.failCommand(id, body.error || 'failed')
      return respond(response, 200, { ok: true, data: entry })
    }

    if (path === '/action/complete_command') {
      const entry = this.chatBridge.completeCommand(
        body.id,
        body.result || null
      )
      return respond(response, 200, { ok: true, data: entry })
    }

    const taskAlias = path.match(/^\/task\/(\w+)$/)
    if (taskAlias) {
      const mapped = this.aliasAction(taskAlias[1], body) || {
        skill: taskAlias[1],
        input: body
      }
      const task = this.taskManager.start(mapped.skill, mapped.input, {
        requestedBy: body.requestedBy || 'hermes'
      })
      return respond(response, 202, { ok: true, data: task })
    }

    const actionMatch = path.match(/^\/action\/(\w+)$/)
    if (actionMatch) {
      const mapped = this.aliasAction(actionMatch[1], body)
      if (!mapped) {
        return respond(
          response,
          404,
          errorPayload(new Error('Unknown action alias.'), 'NOT_FOUND')
        )
      }
      const result = await this.executeSkill(mapped.skill, mapped.input)
      return respond(response, resultStatus(result), result)
    }

    return respond(
      response,
      404,
      errorPayload(new Error('Endpoint not found.'), 'NOT_FOUND')
    )
  }

  async handle(request, response) {
    const url = new URL(request.url, `http://${this.host}`)
    const path = url.pathname.replace(/\/$/, '') || '/'

    if (!this.isAuthorized(request, path)) {
      return respond(
        response,
        401,
        errorPayload(new Error('Invalid Earl API token.'), 'UNAUTHORIZED')
      )
    }

    try {
      if (request.method === 'GET') {
        return await this.handleGet(path, url, response)
      }
      if (request.method === 'POST') {
        return await this.handlePost(path, request, response)
      }
      return respond(
        response,
        405,
        errorPayload(new Error('Method not allowed.'), 'METHOD_NOT_ALLOWED')
      )
    } catch (error) {
      const status = error.code === 'TASK_BUSY'
        ? 409
        : error.code === 'NOT_FOUND'
          ? 404
          : error.code === 'PROCEDURE_NOT_APPROVED'
            ? 403
            : [
                'INVALID_JSON',
                'BODY_TOO_LARGE',
                'INVALID_PROCEDURE',
                'PROCEDURE_EXISTS',
                'PROCEDURE_REVIEWED'
              ].includes(error.code)
              ? 400
              : 500
      return respond(response, status, errorPayload(error))
    }
  }

  async start() {
    if (this.server) return this.address()

    this.server = http.createServer((request, response) => {
      void this.handle(request, response)
    })

    await new Promise((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(this.port, this.host, resolve)
    })

    return this.address()
  }

  address() {
    const address = this.server && this.server.address()
    return typeof address === 'object' && address
      ? { host: address.address, port: address.port }
      : { host: this.host, port: this.port }
  }

  async stop() {
    if (!this.server) return
    const server = this.server
    this.server = null
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
  }
}

module.exports = EarlApiServer
module.exports.ACTION_ALIASES = ACTION_ALIASES
module.exports.readJson = readJson
