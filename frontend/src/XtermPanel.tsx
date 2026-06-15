import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { TermSocket } from './useTermSocket'

interface Props {
  socket: TermSocket
}

export function XtermPanel({ socket }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const el = containerRef.current

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 16,
      fontFamily: '"MesloLGS NF", ui-monospace, monospace',
      theme: { background: '#1a1a1a', foreground: '#e0e0e0', cursor: '#4ade80' },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el)
    fit.fit()

    const sendResize = () => {
      fit.fit()
      socket.sendResize(term.cols, term.rows)
    }
    const ro = new ResizeObserver(sendResize)
    ro.observe(el)

    const unsubData = socket.onData((data) => term.write(data))
    const disposeInput = term.onData((data) => socket.sendData(data))

    if (socket.status === 'connected') sendResize()

    return () => {
      ro.disconnect()
      unsubData()
      disposeInput.dispose()
      term.dispose()
    }
  }, [socket])

  return <div ref={containerRef} style={{ height: '100%', width: '100%' }} />
}
