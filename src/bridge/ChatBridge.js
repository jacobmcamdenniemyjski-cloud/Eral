const { EventEmitter } = require('node:events')

class ChatBridge {
  constructor(options = {}) {
    this.maxMessages = options.maxMessages || 200
    this.maxCommands = options.maxCommands || 100
    this.messages = []
    this.commands = []
    this.nextMessageId = 1
    this.nextCommandId = 1
    this.events = new EventEmitter()
    this.events.setMaxListeners(50)
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
    this.events.emit('message', { ...entry })
    return { ...entry }
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
    this.events.emit('command', { ...entry })
    return { ...entry }
  }

  getMessages(options = {}) {
    const after = Number(options.after) || 0
    const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 200)
    return this.messages
      .filter((entry) => entry.id > after)
      .slice(-limit)
      .map((entry) => ({ ...entry }))
  }

  getCommands(options = {}) {
    const status = options.status || 'pending'
    const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 100)
    return this.commands
      .filter((entry) => status === 'all' || entry.status === status)
      .slice(0, limit)
      .map((entry) => ({ ...entry }))
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
    return { ...entry }
  }

  completeCommand(id, result = null) {
    const entry = this.findCommand(id)
    if (!entry) throw new Error(`Unknown command id: ${id}`)
    if (!['pending', 'claimed'].includes(entry.status)) {
      throw new Error(`Command ${id} is already ${entry.status}.`)
    }
    entry.status = 'completed'
    entry.completedAt = new Date().toISOString()
    entry.result = result
    return { ...entry }
  }

  failCommand(id, error) {
    const entry = this.findCommand(id)
    if (!entry) throw new Error(`Unknown command id: ${id}`)
    entry.status = 'failed'
    entry.completedAt = new Date().toISOString()
    entry.result = {
      error: error && error.message ? error.message : String(error || 'failed')
    }
    return { ...entry }
  }

  summary() {
    return {
      messages: this.messages.length,
      pendingCommands: this.commands.filter(
        (entry) => entry.status === 'pending'
      ).length,
      claimedCommands: this.commands.filter(
        (entry) => entry.status === 'claimed'
      ).length
    }
  }
}

module.exports = ChatBridge
