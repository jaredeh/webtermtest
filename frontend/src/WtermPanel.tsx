import { useEffect, useState } from 'react'
import { Terminal, useTerminal } from '@wterm/react'
import { GhosttyCore } from '@wterm/ghostty'
import '@wterm/react/css'
import type { TermSocket } from './useTermSocket'

interface Props {
  socket: TermSocket
}

// Load GhosttyCore once — ~400 KB WASM, don't reload on remount.
let corePromise: Promise<GhosttyCore> | null = null

// CSS vars passed inline so they win over the package stylesheet regardless of
// bundle injection order. --term-font-family must be set before Terminal mounts
// because autoResize measures 1ch to compute cols — wrong font = wrong col count.
const TERM_STYLE: React.CSSProperties & Record<string, string> = {
  height: '100%',
  width: '100%',
  padding: '4px',
  borderRadius: '0',
  boxShadow: 'none',
  '--term-font-family': '"MesloLGS NF", ui-monospace, monospace',
  '--term-font-size': '16px',
  '--term-row-height': '20px',
  '--term-bg': '#1a1a1a',
  '--term-fg': '#e0e0e0',
  '--term-cursor': '#4ade80',
}

export function WtermPanel({ socket }: Props) {
  const { ref, write } = useTerminal()
  const [core, setCore] = useState<GhosttyCore | null>(null)

  useEffect(() => {
    // Load WASM + await font together so Terminal mounts only after 1ch is correct.
    Promise.all([
      (corePromise ??= GhosttyCore.load()),
      document.fonts.load('16px "MesloLGS NF"').catch(() => {}),
    ]).then(([resolved]) => setCore(resolved)).catch(console.error)
  }, [])

  useEffect(() => {
    if (!core) return
    return socket.onData((bytes) => write(bytes))
  }, [core, socket, write])

  if (!core) return <div style={{ color: '#666', padding: '1rem', fontFamily: 'monospace' }}>Loading ghostty WASM...</div>

  return (
    <Terminal
      ref={ref}
      core={core}
      autoResize
      cursorBlink
      onData={(data) => socket.sendData(data)}
      onResize={(cols, rows) => socket.sendResize(cols, rows)}
      onReady={(wt) => socket.sendResize(wt.cols, wt.rows)}
      style={TERM_STYLE}
    />
  )
}
