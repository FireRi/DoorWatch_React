/**
 * mqttClient.js
 * Pure browser MQTT 3.1.1 over WebSocket — zero dependencies
 * Works in any browser without Node.js polyfills
 */

const enc = new TextEncoder()
const dec = new TextDecoder()

function encodeStr(str) {
  const b = enc.encode(str)
  return [b.length >> 8, b.length & 0xff, ...b]
}

function encodeLen(len) {
  const out = []
  do {
    let byte = len % 128
    len = Math.floor(len / 128)
    if (len > 0) byte |= 128
    out.push(byte)
  } while (len > 0)
  return out
}

function buildConnect(clientId, username, password, keepalive = 30) {
  const proto   = encodeStr('MQTT')
  const cid     = encodeStr(clientId)
  const uname   = encodeStr(username)
  const pwd     = encodeStr(password)
  const flags   = 0b11000010 // username + password + clean session
  const varHdr  = [...proto, 4, flags, keepalive >> 8, keepalive & 0xff]
  const payload = [...cid, ...uname, ...pwd]
  const remain  = [...varHdr, ...payload]
  return new Uint8Array([(1 << 4), ...encodeLen(remain.length), ...remain])
}

function buildSubscribe(topic, pid = 1) {
  const t      = encodeStr(topic)
  const varHdr = [pid >> 8, pid & 0xff]
  const remain = [...varHdr, ...t, 0]
  return new Uint8Array([((8 << 4) | 0x02), ...encodeLen(remain.length), ...remain])
}

function buildPing() {
  return new Uint8Array([(12 << 4), 0])
}

function parsePackets(buf) {
  const pkts = []
  let i = 0
  while (i < buf.length) {
    const type = (buf[i] >> 4) & 0x0f
    i++
    let mult = 1, len = 0, b
    do { b = buf[i++]; len += (b & 127) * mult; mult *= 128 } while (b & 128)
    pkts.push({ type, data: buf.slice(i, i + len) })
    i += len
  }
  return pkts
}

function decodePublish(data) {
  const tLen  = (data[0] << 8) | data[1]
  const topic = dec.decode(data.slice(2, 2 + tLen))
  const msg   = dec.decode(data.slice(2 + tLen))
  return { topic, msg }
}

export default class MqttClient {
  constructor() {
    this.ws           = null
    this.ping         = null
    this.reconnTimer  = null
    this.destroyed    = false
    this.subs         = []
    this._opts        = {}

    this.onConnect    = null
    this.onMessage    = null
    this.onDisconnect = null
    this.onError      = null
  }

  connect(url, opts = {}) {
    this._url  = url
    this._opts = opts
    this._open()
    return this
  }

  _open() {
    if (this.destroyed) return
    const { username, password, clientId, keepalive = 30, reconnectPeriod = 5000 } = this._opts
    this._keepalive      = keepalive
    this._reconnectPeriod = reconnectPeriod

    try {
      this.ws = new WebSocket(this._url, ['mqtt'])
      this.ws.binaryType = 'arraybuffer'

      this.ws.onopen = () => {
        this.ws.send(buildConnect(clientId, username, password, keepalive))
      }

      this.ws.onmessage = ({ data }) => {
        const pkts = parsePackets(new Uint8Array(data))
        pkts.forEach(p => this._handle(p))
      }

      this.ws.onerror = e => {
        this.onError?.(e)
        this._scheduleReconnect()
      }

      this.ws.onclose = () => {
        this._stopPing()
        this.onDisconnect?.()
        this._scheduleReconnect()
      }
    } catch (e) {
      this.onError?.(e)
      this._scheduleReconnect()
    }
  }

  _handle({ type, data }) {
    if (type === 2) {           // CONNACK
      if (data[1] === 0) {
        this._startPing()
        this.subs.forEach(t => this.ws.send(buildSubscribe(t)))
        this.onConnect?.()
      } else {
        this.onError?.(new Error(`CONNACK error: ${data[1]}`))
      }
    } else if (type === 3) {    // PUBLISH
      const { topic, msg } = decodePublish(data)
      this.onMessage?.(topic, msg)
    }
    // PINGRESP (type 13) — no action needed
  }

  subscribe(topic) {
    if (!this.subs.includes(topic)) this.subs.push(topic)
    if (this.ws?.readyState === WebSocket.OPEN)
      this.ws.send(buildSubscribe(topic))
  }

  _startPing() {
    this._stopPing()
    this.ping = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN)
        this.ws.send(buildPing())
    }, this._keepalive * 800)
  }

  _stopPing() {
    clearInterval(this.ping)
    this.ping = null
  }

  _scheduleReconnect() {
    if (this.destroyed || !this._reconnectPeriod || this.reconnTimer) return
    this.reconnTimer = setTimeout(() => {
      this.reconnTimer = null
      this._open()
    }, this._reconnectPeriod)
  }

  end() {
    this.destroyed = true
    this._stopPing()
    clearTimeout(this.reconnTimer)
    try { this.ws?.close() } catch {}
    this.ws = null
  }
}