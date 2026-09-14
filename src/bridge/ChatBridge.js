const fs = require('node:fs')
const path = require('node:path')
const { EventEmitter } = require('node:events')

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function saveJson(filePath, value) {
  if (!filePath) return
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  fs.renameSync(temporary, filePath)
}

class ChatBridge {
  constructor(options = {}) {
    this.maxMessages = options.maxMessages || 200
    this.maxCommands = options.maxCommands || 100
    this.filePath = options.filePath || null
    this.messages = []
    this.commands = []
    this.nextMessageId = 1
    this.nextCommandId = 1
    this.recoveredCommands = 0
    this.events = new EventEmitter()
    this.events.setMaxListeners(50)
    this.load()
  }

  load() {
    if (!this.filePath) return
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'))
      this.messages = Array.isArray(parsed.messages)
        ? parsed.messages.slice(-this.maxMessages)
        : []
      this.commands = Array.isArray(parsed.commands)
        ? parsed.commands.slice(-this.maxCommands)
        : []
      this.nextMessageId = Math.max(
        Number(parsed.nextMessageId) || 1,
        ...this.messages.map((entry) => Number(entry.id) + 1)
      )
      this.nextCommandId = Math.max(
        Number(parsed.nextCommandId) || 1,
        ...this.commands.map((entry) => Number(entry.id) + 1)
      )

      const recoveredAt = new Date().toISOString()
      for (const entry of this.commands) {
        if (entry.status !== 'claimed') continue
        entry.status = 'pending'
        entry.claimedAt = null
        entry.recoveredAt = recoveredAt
        entry.recoveryCount = (Number(entry.recoveryCount) || 0) + 1
        this.recoveredCommands += 1
      }
      if (this.recoveredCommands > 0) this.save()
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw new Error(`Could not load chat bridge state: ${error.message}`)
      }
    }
  }

  save() {
    saveJson(this.filePath, {
      version: 1,
      nextMessageId: this.nextMessageId,
      nextCommandId: this.nextCommandId,
      messages: this.messages,
      commands: this.commands
    })
  }

  recordMessage(username, message, metadata = {}) {
    const entry = {
      id: this.nextMessageId++,
      time: new Date().toISOString(),
      from: username,
      message: String(message || ''),
      ...metadata
    }
    this.messages.push(entry)
    this.messages = this.messages.slice(-this.maxMessages)
    this.save()
    this.events.emit('message', clone(entry))
    return clone(entry)
  }

  enqueue(username, command, metadata = {}) {
    const textValue = String(command || '').trim()
    if (!textValue) throw new Error('Cannot enqueue an empty command.')

    const entry = {
      id: this.nextCommandId++,
      time: new Date().toISOString(),
      from: username,
      command: textValue,
      status: 'pending',
      source: metadata.source || 'minecraft',
      claimedAt: null,
      completedAt: null,
      result: null
    }
    this.commands.push(entry)
    this.commands = this.commands.slice(-this.maxCommands)
    this.save()
    this.events.emit('command', clone(entry))
    return clone(entry)
  }

  getMessages(options = {}) {
    const after = Number(options.after) || 0
    const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 200)
    return this.messages
      .filter((entry) => entry.id > after)
      .slice(-limit)
      .map(clone)
  }

  getCommands(options = {}) {
    const status = options.status || 'pending'
    const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 100)
    return this.commands
      .filter((entry) => status === 'all' || entry.status === status)
      .slice(0, limit)
      .map(clone)
  }

  async waitForCommands(options = {}) {
    const timeoutMs = Math.min(
      Math.max(Number(options.timeoutMs) || 25000, 100),
      30000
    )
    const pending = this.getCommands(options)
    if (pending.length > 0) return pending

    return new Promise((resolve) => {
      let timer
      const finish = () => {
        clearTimeout(timer)
        this.events.removeListener('command', onCommand)
        resolve(this.getCommands(options))
      }
      const onCommand = () => finish()
      timer = setTimeout(finish, timeoutMs)
      this.events.once('command', onCommand)
    })
  }

  findCommand(id) {
    return this.commands.find((entry) => entry.id === Number(id)) || null
  }

  claimCommand(id) {
    const entry = this.findCommand(id)
    if (!entry) throw new Error(`Unknown command id: ${id}`)
    if (entry.status !== 'pending') {
      throw new Error(`Command ${id} is already ${entry.status}.`)
    }
    entry.status = 'claimed'
    entry.claimedAt = new Date().toISOString()
    this.save()
    return clone(entry)
  }

  completeCommand(id, result = null) {
    const entry = this.findCommand(id)
    if (!entry) throw new Error(`Unknown command id: ${id}`)
    if (!['pending', 'claimed'].includes(entry.status)) {
      throw new Error(`Command ${id} is already ${entry.status}.`)
    }
    entry.status = 'completed'
    entry.completedAt = new Date().toISOString()
    entry.result = clone(result)
    this.save()
    return clone(entry)
  }

  failCommand(id, error) {
    const entry = this.findCommand(id)
    if (!entry) throw new Error(`Unknown command id: ${id}`)
    if (!['pending', 'claimed'].includes(entry.status)) {
      throw new Error(`Command ${id} is already ${entry.status}.`)
    }
    entry.status = 'failed'
    entry.completedAt = new Date().toISOString()
    entry.result = {
      error: error && error.message ? error.message : String(error || 'failed')
    }
    this.save()
    return clone(entry)
  }

  summary() {
    return {
      messages: this.messages.length,
      pendingCommands: this.commands.filter(
        (entry) => entry.status === 'pending'
      ).length,
      claimedCommands: this.commands.filter(
        (entry) => entry.status === 'claimed'
      ).length,
      recoveredCommands: this.recoveredCommands,
      persistent: Boolean(this.filePath)
    }
  }
}

module.exports = ChatBridge
