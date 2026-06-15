import { useEffect, useRef, useState } from 'react'

export type SocketStatus = 'connecting' | 'connected' | 'disconnected'

export interface TermSocket {
  status: SocketStatus
  sendData: (data: string | Uint8Array<ArrayBuffer>) => void
  sendResize: (cols: number, rows: number) => void
  onData: (handler: (data: Uint8Array) => void) => () => void
}

export function useTermSocket(): TermSocket {
  const dataWs = useRef<WebSocket | null>(null)
  const ctrlWs = useRef<WebSocket | null>(null)
  const [status, setStatus] = useState<SocketStatus>('connecting')
  const dataHandlers = useRef<Set<(data: Uint8Array) => void>>(new Set())

  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const host = window.location.host

    const data = new WebSocket(`${proto}://${host}/ws/frontend`)
    const ctrl = new WebSocket(`${proto}://${host}/ws/control`)
    dataWs.current = data
    ctrlWs.current = ctrl

    data.binaryType = 'arraybuffer'

    data.onopen = () => setStatus('connected')
    data.onclose = () => setStatus('disconnected')
    data.onerror = () => setStatus('disconnected')

    data.onmessage = (ev) => {
      const bytes = new Uint8Array(ev.data instanceof ArrayBuffer ? ev.data : new TextEncoder().encode(ev.data))
      dataHandlers.current.forEach(h => h(bytes))
    }

    return () => {
      data.close()
      ctrl.close()
    }
  }, [])

  return {
    status,
    sendData(data) {
      if (dataWs.current?.readyState === WebSocket.OPEN) {
        dataWs.current.send(data)
      }
    },
    sendResize(cols, rows) {
      if (ctrlWs.current?.readyState === WebSocket.OPEN) {
        ctrlWs.current.send(JSON.stringify({ event: 'resize', cols, rows }))
      }
    },
    onData(handler) {
      dataHandlers.current.add(handler)
      return () => { dataHandlers.current.delete(handler) }
    },
  }
}
