import { useState, useEffect, useRef, useCallback } from 'react'
import MqttClient from './mqttClient'

// ── Theme ─────────────────────────────────────────────────────
const C = {
  bg:       '#0D0D14',
  surface:  '#16161F',
  surface2: '#1E1E2A',
  border:   '#2A2A3A',
  red:      '#FF3B3B',
  redDim:   '#2A1010',
  green:    '#2DFF7F',
  greenDim: '#0A2018',
  yellow:   '#FFD166',
  text:     '#E8E8F2',
  muted:    '#5A5A7A',
}

// ── Global styles ─────────────────────────────────────────────
const globalStyle = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: ${C.bg};
    color: ${C.text};
    font-family: 'DM Sans', system-ui, sans-serif;
    min-height: 100vh;
    overflow-x: hidden;
  }
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700;800&family=Space+Mono:wght@400;700&display=swap');
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: ${C.bg}; }
  ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 4px; }
  @keyframes slideIn {
    from { opacity: 0; transform: translateY(-8px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes pulse {
    0%, 100% { transform: scale(1); }
    50%       { transform: scale(1.05); }
  }
  @keyframes toastIn {
    from { opacity: 0; transform: translateX(-50%) translateY(-20px); }
    to   { opacity: 1; transform: translateX(-50%) translateY(0); }
  }
`

// ── Storage helpers ───────────────────────────────────────────
const STORE = 'doorwatch_cfg'
function loadCfg() {
  try { return JSON.parse(localStorage.getItem(STORE)) || {} } catch { return {} }
}
function saveCfg(cfg) {
  localStorage.setItem(STORE, JSON.stringify(cfg))
}

// ── Notification helpers ──────────────────────────────────────
async function requestNotifPermission() {
  if (!('Notification' in window)) return false
  const result = await Notification.requestPermission()
  return result === 'granted'
}

function sendNotification(title, body) {
  if (Notification.permission === 'granted') {
    new Notification(title, { body, icon: '🚨' })
  }
}

// ── Tab definitions ───────────────────────────────────────────
const TABS = ['🏠 Home', '📋 Log', '⚙️ Settings']

// ─────────────────────────────────────────────────────────────
//  ROOT APP
// ─────────────────────────────────────────────────────────────
export default function App() {
  const [tab,        setTab]        = useState(0)
  const [cfg,        setCfg]        = useState(loadCfg)
  const [connStatus, setConnStatus] = useState('disconnected')
  const [events,     setEvents]     = useState([])
  const [violations, setViolations] = useState(0)
  const [lastAlert,  setLastAlert]  = useState(null)
  const [notifOn,    setNotifOn]    = useState(Notification.permission === 'granted')
  const [toast,      setToast]      = useState(null)
  const mqttRef  = useRef(null)
  const toastRef = useRef(null)

  const showToast = useCallback((msg) => {
    setToast(msg)
    clearTimeout(toastRef.current)
    toastRef.current = setTimeout(() => setToast(null), 3500)
  }, [])

  const addEvent = useCallback((type, label, meta, device = '') => {
    setEvents(prev => [
      { id: Date.now(), type, label, meta, device },
      ...prev.slice(0, 99)
    ])
  }, [])

  const handlePayload = useCallback((payload) => {
    const { event = '', date = '', time = '', device = '' } = payload
    const meta = `${date} · ${time}`

    if (event === 'CURFEW_VIOLATION') {
      setViolations(v => v + 1)
      setLastAlert({ time, date })
      addEvent('violation', '🚨 Curfew Violation', meta, device)
      showToast(`🚨 Door opened at ${time}`)
      if (notifOn) sendNotification('🚨 Curfew Violation!', `Door opened at ${time} on ${date}`)
    } else if (event === 'DOOR_OPENED') {
      addEvent('opened', '🔓 Door Opened', meta, device)
    } else if (event === 'DOOR_CLOSED') {
      addEvent('closed', '🔒 Door Closed', meta, device)
    }
  }, [notifOn, addEvent, showToast])

  const connect = useCallback((config) => {
    if (!config?.host || !config?.user || !config?.pass) return
    if (mqttRef.current) { try { mqttRef.current.end(true) } catch {} }

    setConnStatus('connecting')
    const url = `wss://${config.host}:8884/mqtt`
const client = new MqttClient()
client.onConnect    = () => {
  setConnStatus('connected')
  client.subscribe(config.topic || 'home/door/curfew_alert')
  client.subscribe('home/door/status')
  addEvent('system', '● Connected', `Broker: ${config.host}`)
}
client.onMessage    = (topic, message) => {
  try { handlePayload(JSON.parse(message)) } catch {}
}
client.onError      = () => setConnStatus('error')
client.onDisconnect = () => setConnStatus('disconnected')

client.connect(url, {
  username:        config.user,
  password:        config.pass,
  clientId:        'DoorWatch_React_' + Math.random().toString(16).slice(2, 8),
  keepalive:       30,
  reconnectPeriod: 5000,
})

    mqttRef.current = client
  }, [handlePayload, addEvent])

  // Load config and connect on mount
  useEffect(() => {
    const saved = loadCfg()
    if (saved?.host) connect(saved)
    return () => { mqttRef.current?.end(true) }
  }, [])

  const applyConfig = useCallback((newCfg) => {
    setCfg(newCfg)
    saveCfg(newCfg)
    connect(newCfg)
  }, [connect])

  const toggleNotif = async () => {
    if (notifOn) {
      setNotifOn(false)
      showToast('Notifications disabled.')
    } else {
      const granted = await requestNotifPermission()
      setNotifOn(granted)
      showToast(granted ? '🔔 Notifications enabled!' : 'Permission denied.')
    }
  }

  // Badge count for Home tab
  const badge = violations > 0 ? violations : null

  return (
    <>
      <style>{globalStyle}</style>

      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', maxWidth: 480, margin: '0 auto' }}>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 80 }}>
          {tab === 0 && (
            <HomeTab
              connStatus={connStatus}
              events={events}
              violations={violations}
              lastAlert={lastAlert}
              notifOn={notifOn}
              toggleNotif={toggleNotif}
              clearEvents={() => setEvents([])}
              sheetsUrl={cfg?.sheets || ''}
              showToast={showToast}
            />
          )}
          {tab === 1 && <LogTab events={events} clearEvents={() => setEvents([])} />}
          {tab === 2 && <SettingsTab cfg={cfg} connStatus={connStatus} applyConfig={applyConfig} showToast={showToast} />}
        </div>

        {/* Bottom nav */}
        <div style={{
          position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
          width: '100%', maxWidth: 480,
          background: C.surface, borderTop: `1px solid ${C.border}`,
          display: 'flex',
        }}>
          {TABS.map((t, i) => (
            <button key={i} onClick={() => setTab(i)} style={{
              flex: 1, padding: '14px 0 18px',
              background: 'none', border: 'none', cursor: 'pointer',
              color: tab === i ? C.red : C.muted,
              fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
              position: 'relative',
            }}>
              <div style={{ fontSize: 20, marginBottom: 2 }}>{t.split(' ')[0]}</div>
              <div>{t.split(' ')[1]}</div>
              {i === 0 && badge && (
                <div style={{
                  position: 'absolute', top: 8, right: '28%',
                  background: C.red, color: '#fff', borderRadius: 999,
                  fontSize: 9, fontWeight: 800, padding: '1px 5px', minWidth: 16, textAlign: 'center'
                }}>{badge}</div>
              )}
            </button>
          ))}
        </div>

        {/* Toast */}
        {toast && (
          <div style={{
            position: 'fixed', top: 20, left: '50%',
            transform: 'translateX(-50%)',
            background: C.red, color: '#fff',
            padding: '10px 20px', borderRadius: 12,
            fontSize: 13, fontWeight: 600,
            zIndex: 999, whiteSpace: 'nowrap',
            animation: 'toastIn 0.3s ease',
          }}>{toast}</div>
        )}
      </div>
    </>
  )
}

// ─────────────────────────────────────────────────────────────
//  HOME TAB
// ─────────────────────────────────────────────────────────────
function HomeTab({ connStatus, events, violations, lastAlert, notifOn, toggleNotif, clearEvents, sheetsUrl, showToast }) {
  const latest = events[0]
  const isViolation = latest?.type === 'violation'

  const statusCfg = {
    connected:    { color: C.green, bg: C.greenDim, label: '● Connected' },
    connecting:   { color: C.yellow, bg: '#1A1800', label: '○ Connecting…' },
    disconnected: { color: C.muted, bg: C.surface2, label: '● Disconnected' },
    error:        { color: C.red, bg: C.redDim, label: '● Error' },
  }[connStatus] || { color: C.muted, bg: C.surface2, label: '● Disconnected' }

  const doorEmoji = isViolation ? '🚨' : latest?.type === 'opened' ? '🔓' : latest?.type === 'closed' ? '🔒' : '🚪'
  const doorText  = isViolation ? 'CURFEW VIOLATION!' : latest?.type === 'opened' ? 'Door Opened' : latest?.type === 'closed' ? 'Door Closed' : 'Waiting…'
  const doorColor = isViolation ? C.red : latest?.type === 'opened' ? C.yellow : C.green

  const openSheets = () => {
    if (sheetsUrl) window.open(sheetsUrl, '_blank')
    else showToast('No Sheets URL set — add it in Settings.')
  }

  return (
    <div style={{ padding: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 36, height: 36, background: C.red, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🚪</div>
          <span style={{ fontFamily: 'Space Mono, monospace', fontWeight: 700, fontSize: 16 }}>
            Door<span style={{ color: C.red }}>Watch</span>
          </span>
        </div>
        <div style={{
          padding: '4px 12px', borderRadius: 999, fontSize: 11, fontWeight: 600,
          fontFamily: 'Space Mono, monospace',
          color: statusCfg.color, background: statusCfg.bg,
          border: `1px solid ${statusCfg.color}`,
        }}>{statusCfg.label}</div>
      </div>

      {/* Status card */}
      <div style={{
        background: C.surface, border: `1px solid ${isViolation ? C.red : C.border}`,
        borderRadius: 18, padding: 20, display: 'flex', alignItems: 'center', gap: 16,
        marginBottom: 12,
        animation: isViolation ? 'pulse 0.6s ease 3' : 'none',
      }}>
        <div style={{
          width: 60, height: 60, borderRadius: 16, fontSize: 28,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: isViolation ? C.redDim : C.greenDim,
          border: `1px solid ${doorColor}`,
        }}>{doorEmoji}</div>
        <div>
          <div style={{ fontSize: 10, color: C.muted, letterSpacing: 1.5, fontWeight: 700, marginBottom: 4 }}>DOOR STATUS</div>
          <div style={{ fontSize: 17, fontWeight: 800, color: doorColor }}>{doorText}</div>
          {latest && <div style={{ fontSize: 11, color: C.muted, marginTop: 4, fontFamily: 'Space Mono, monospace' }}>{latest.meta}</div>}
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <StatBox label="VIOLATIONS" value={violations} sub="this session" valueColor={C.red} />
        <StatBox label="LAST ALERT" value={lastAlert?.time || '—'} sub={lastAlert?.date || 'no alerts yet'} small={!!lastAlert} />
      </div>

      {/* Curfew info */}
      <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>🌙 Curfew Window</div>
        <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6 }}>9:00 PM — 6:00 AM · Alerts active during these hours only</div>
      </div>

      {/* Log header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 11, color: C.muted, letterSpacing: 2, fontWeight: 700, fontFamily: 'Space Mono, monospace' }}>EVENT LOG</span>
        <button onClick={clearEvents} style={{
          background: 'none', border: `1px solid ${C.border}`, borderRadius: 6,
          padding: '4px 10px', color: C.muted, fontSize: 11, cursor: 'pointer',
          fontFamily: 'Space Mono, monospace',
        }}>Clear</button>
      </div>

      {/* Log entries */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
        {events.length === 0
          ? <div style={{ textAlign: 'center', padding: '40px 0', color: C.muted }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
              <div>No events yet. Waiting for door activity…</div>
            </div>
          : events.map(ev => <LogEntry key={ev.id} event={ev} />)
        }
      </div>

      {/* Bottom actions */}
      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={toggleNotif} style={{
          flex: 1, padding: 14, borderRadius: 12, border: notifOn ? `1px solid ${C.green}` : 'none',
          background: notifOn ? C.greenDim : C.red, color: notifOn ? C.green : '#fff',
          fontWeight: 700, fontSize: 14, cursor: 'pointer',
        }}>
          {notifOn ? '🔔 Notifications ON' : 'Enable Notifications'}
        </button>
        <button onClick={openSheets} style={{
          padding: '14px 16px', borderRadius: 12,
          background: C.surface2, border: `1px solid ${C.border}`,
          color: C.text, fontSize: 18, cursor: 'pointer',
        }}>📊</button>
      </div>
    </div>
  )
}

function StatBox({ label, value, sub, valueColor, small }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 16 }}>
      <div style={{ fontSize: 10, color: C.muted, letterSpacing: 1.5, fontWeight: 700, marginBottom: 6, fontFamily: 'Space Mono, monospace' }}>{label}</div>
      <div style={{ fontSize: small ? 16 : 28, fontWeight: 800, color: valueColor || C.text, fontFamily: 'Space Mono, monospace', paddingTop: small ? 4 : 0 }}>{value}</div>
      <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{sub}</div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
//  LOG TAB
// ─────────────────────────────────────────────────────────────
function LogTab({ events, clearEvents }) {
  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <span style={{ fontSize: 11, color: C.muted, letterSpacing: 2, fontWeight: 700, fontFamily: 'Space Mono, monospace' }}>EVENT LOG</span>
        <button onClick={clearEvents} style={{
          background: 'none', border: `1px solid ${C.border}`, borderRadius: 6,
          padding: '4px 10px', color: C.muted, fontSize: 11, cursor: 'pointer',
        }}>Clear</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {events.length === 0
          ? <div style={{ textAlign: 'center', padding: '60px 0', color: C.muted }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>📭</div>
              <div>No events yet.<br />Waiting for door activity…</div>
            </div>
          : events.map(ev => <LogEntry key={ev.id} event={ev} />)
        }
      </div>
    </div>
  )
}

function LogEntry({ event: ev }) {
  const dotColor = ev.type === 'violation' ? C.red : ev.type === 'opened' ? C.yellow : ev.type === 'closed' ? C.green : C.muted
  return (
    <div style={{
      background: ev.type === 'violation' ? '#150C0C' : C.surface,
      border: `1px solid ${ev.type === 'violation' ? '#3A1010' : C.border}`,
      borderRadius: 14, padding: '14px 16px',
      display: 'flex', alignItems: 'flex-start', gap: 12,
      animation: 'slideIn 0.3s ease',
    }}>
      <div style={{
        width: 10, height: 10, borderRadius: '50%', marginTop: 4, flexShrink: 0,
        background: dotColor,
        boxShadow: ev.type === 'violation' ? `0 0 6px ${C.red}` : 'none',
      }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>{ev.label}</div>
        <div style={{ fontSize: 11, color: C.muted, fontFamily: 'Space Mono, monospace' }}>{ev.meta}</div>
        {ev.device && <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{ev.device}</div>}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
//  SETTINGS TAB
// ─────────────────────────────────────────────────────────────
function SettingsTab({ cfg, connStatus, applyConfig, showToast }) {
  const [host,       setHost]       = useState(cfg?.host   || '')
  const [user,       setUser]       = useState(cfg?.user   || '')
  const [pass,       setPass]       = useState(cfg?.pass   || '')
  const [topic,      setTopic]      = useState(cfg?.topic  || 'home/door/curfew_alert')
  const [sheets,     setSheets]     = useState(cfg?.sheets || '')
  const [showPass,   setShowPass]   = useState(false)

  const save = () => {
    const newCfg = { host: host.trim(), user: user.trim(), pass, topic: topic.trim() || 'home/door/curfew_alert', sheets: sheets.trim() }
    applyConfig(newCfg)
    showToast('✓ Saved and connecting…')
  }

  const connColor = connStatus === 'connected' ? C.green : connStatus === 'error' ? C.red : C.muted
  const connLabel = connStatus === 'connected' ? '✓ Connected to HiveMQ' : connStatus === 'connecting' ? '○ Connecting…' : connStatus === 'error' ? '✗ Connection Error' : '○ Not Connected'

  return (
    <div style={{ padding: 20 }}>
      <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 20 }}>⚙ Configuration</div>

      {/* Status pill */}
      <div style={{
        border: `1px solid ${connColor}`, borderRadius: 10, padding: 12, marginBottom: 24,
        background: connStatus === 'connected' ? C.greenDim : C.surface2,
        color: connColor, fontSize: 13, fontWeight: 600,
      }}>{connLabel}</div>

      <GroupLabel>HIVEMQ CLOUD</GroupLabel>

      <Field label="Broker Host" value={host} onChange={setHost} placeholder="abc123.s1.eu.hivemq.cloud" />
      <Field label="Username" value={user} onChange={setUser} placeholder="hivemq_username" />
      <Field
        label="Password" value={pass} onChange={setPass}
        placeholder="••••••••" type={showPass ? 'text' : 'password'}
        right={
          <button onClick={() => setShowPass(p => !p)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 8px', fontSize: 16 }}>
            {showPass ? '🙈' : '👁'}
          </button>
        }
      />
      <Field label="Alert Topic" value={topic} onChange={setTopic} placeholder="home/door/curfew_alert" />

      <GroupLabel style={{ marginTop: 24 }}>GOOGLE SHEETS LOG</GroupLabel>
      <Field label="Spreadsheet URL" value={sheets} onChange={setSheets} placeholder="https://docs.google.com/spreadsheets/d/..." />

      {sheets && (
        <button onClick={() => window.open(sheets, '_blank')} style={{
          width: '100%', padding: 14, borderRadius: 12, marginBottom: 14,
          background: C.surface2, border: `1px solid ${C.border}`,
          color: C.green, fontWeight: 700, fontSize: 14, cursor: 'pointer',
        }}>📊 Open Google Sheets Log</button>
      )}

      <button onClick={save} style={{
        width: '100%', padding: 16, borderRadius: 14, border: 'none',
        background: C.red, color: '#fff', fontWeight: 800, fontSize: 16,
        cursor: 'pointer', marginBottom: 24,
        boxShadow: `0 4px 20px ${C.red}66`,
      }}>Connect & Save</button>

      <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>DoorWatch v1.0</div>
        <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.8 }}>
          Connects to HiveMQ Cloud via MQTT over WebSocket (WSS).<br />
          Curfew window: 9:00 PM – 6:00 AM.<br />
          Config is saved in your browser's localStorage.
        </div>
      </div>
    </div>
  )
}

function GroupLabel({ children, style }) {
  return (
    <div style={{ fontSize: 10, color: C.muted, letterSpacing: 2, fontWeight: 700, marginBottom: 12, fontFamily: 'Space Mono, monospace', ...style }}>
      {children}
    </div>
  )
}

function Field({ label, value, onChange, placeholder, type = 'text', right }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: C.muted, letterSpacing: 1, fontWeight: 700, marginBottom: 6, fontFamily: 'Space Mono, monospace' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          style={{
            flex: 1, background: C.surface2, border: `1px solid ${C.border}`,
            borderRadius: 12, padding: '12px 14px',
            color: C.text, fontSize: 13, fontFamily: 'Space Mono, monospace',
            outline: 'none',
          }}
        />
        {right}
      </div>
    </div>
  )
}
