import { useState } from 'react'
import { useTermSocket } from './useTermSocket'
import { XtermPanel } from './XtermPanel'
import { GhosttyPanel } from './GhosttyPanel'
import { WtermPanel } from './WtermPanel'

type Engine = 'xterm' | 'ghostty' | 'wterm'

export default function App() {
  const socket = useTermSocket()
  const [engine, setEngine] = useState<Engine>('ghostty')
  const connected = socket.status === 'connected'

  return (
    <>
      <header>
        <h1>WebTerm Prototype</h1>
        <div className="engine-tabs">
          <button className={engine === 'xterm' ? 'active' : ''} onClick={() => setEngine('xterm')}>Xterm.js</button>
          <button className={engine === 'ghostty' ? 'active' : ''} onClick={() => setEngine('ghostty')}>Ghostty WASM</button>
          <button className={engine === 'wterm' ? 'active' : ''} onClick={() => setEngine('wterm')}>wterm/ghostty</button>
        </div>
        <div className={`status-dot ${connected ? 'connected' : ''}`} title={socket.status} />
        <span className="status-text">{socket.status}</span>
      </header>

      <div className="terminal-wrap">
        {engine === 'xterm' && <XtermPanel socket={socket} />}
        {engine === 'ghostty' && <GhosttyPanel socket={socket} />}
        {engine === 'wterm' && <WtermPanel socket={socket} />}
      </div>
    </>
  )
}
