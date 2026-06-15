import { useEffect, useRef } from 'react'
// ghostty-web is the Ghostty terminal emulator compiled to WASM.
// It ships its own canvas renderer and PTY-style write API, similar to xterm.js
// but using Ghostty's native rendering pipeline instead of xterm's DOM/canvas renderer.
import { init, Terminal, FitAddon } from 'ghostty-web'
import type { TermSocket } from './useTermSocket'

interface Props {
  socket: TermSocket
}

// Module-level singleton: ghostty-web's init() loads and compiles the WASM binary.
// This must happen exactly once — calling it twice throws. We cache the promise so
// every GhosttyPanel mount awaits the same load regardless of how many times React
// mounts/unmounts this component (e.g. StrictMode double-mount in dev).
let wasmReady: Promise<void> | null = null

export function GhosttyPanel({ socket }: Props) {
  // containerRef is the DOM div that ghostty-web will attach its canvas into.
  // ghostty-web creates a <canvas> element inside whatever element you pass to term.open().
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const el = containerRef.current

    // disposed: set to true when this effect cleanup runs (component unmount or socket change).
    // Used to bail out of async work that completes after unmount.
    let disposed = false

    // cleanup: populated once the terminal is fully initialized. The effect cleanup
    // function calls this to tear down subscriptions and dispose the terminal.
    // It's null until init completes because there's nothing to clean up before that.
    let cleanup: (() => void) | null = null

    // ??= ensures init() is called at most once across all mounts.
    // We .then() on the shared promise — multiple callers all resolve when WASM is ready.
    ;(wasmReady ??= init()).then(async () => {
      // Guard: component may have unmounted while WASM was loading (e.g. user toggled
      // away from ghostty tab, or React StrictMode unmounted the first mount).
      if (disposed || !el.isConnected) return

      // ghostty-web measures cell width/height using Canvas2D text metrics during term.open().
      // If the font isn't loaded yet, the browser falls back to a system monospace font
      // for measurement, producing wrong cell dimensions — glyphs clip or float.
      // Awaiting fonts.load() blocks until the browser has the font ready to measure.
      await document.fonts.load('16px "MesloLGS NF"').catch(() => {})

      // Second guard after the font await — more async time elapsed.
      if (disposed || !el.isConnected) return

      const term = new Terminal({
        cursorBlink: true,
        fontSize: 16,
        // MesloLGS NF is a Nerd Font patched variant of Meslo — includes powerline
        // glyphs (U+E0B0–E0B3) and other PUA icons used by p10k's status bar.
        // ui-monospace and monospace are fallbacks if the font fails to load.
        fontFamily: '"MesloLGS NF", ui-monospace, monospace',
        // Match the page background (#1a1a1a from index.css). Without a theme,
        // ghostty-web clears the canvas to its own default (#1e1e1e), which differs
        // from the page and makes cell-edge seams more visible. Keep these in sync
        // with XtermPanel/WtermPanel so the side-by-side comparison is fair.
        theme: {
          background: '#1a1a1a',
          foreground: '#e0e0e0',
          cursor: '#4ade80',
        },
      })

      // FitAddon makes the terminal fill its container div by computing cols/rows
      // from the container pixel size and the measured cell dimensions.
      const fit = new FitAddon()
      term.loadAddon(fit)

      // term.open() creates the <canvas> element inside `el` and does initial layout.
      // Font must be loaded before this call (see fonts.load() above).
      term.open(el)

      // fit() computes cols/rows from current container size and resizes the terminal.
      fit.fit()

      // observeResize() attaches a ResizeObserver so the terminal auto-fits when
      // the container div changes size (e.g. window resize, panel layout change).
      fit.observeResize()

      // When ghostty-web computes a new cols/rows (from fit or user resize), forward
      // it to the daemon via the control WebSocket so the PTY gets SIGWINCH.
      const resizeSub = term.onResize(({ cols, rows }) => socket.sendResize(cols, rows))

      // Pipe PTY output (arriving via the data WebSocket) into the terminal renderer.
      const dataSub = socket.onData((bytes) => term.write(bytes))

      // Pipe user keystrokes/paste from the terminal back to the PTY via the data WebSocket.
      const inputSub = term.onData((data) => socket.sendData(data))

      // If the socket connected before the terminal finished initializing, we missed
      // the initial resize. Send it now so the PTY window size is correct from the start.
      if (socket.status === 'connected') socket.sendResize(term.cols, term.rows)

      // Tear down everything in reverse dependency order:
      // subscriptions first, then addons, then the terminal itself.
      cleanup = () => {
        resizeSub.dispose()  // stop forwarding ghostty resize events
        inputSub.dispose()   // stop forwarding keystrokes
        dataSub()            // stop forwarding PTY data (returns void, not Disposable)
        fit.dispose()        // disconnect ResizeObserver
        term.dispose()       // destroy canvas, free WASM memory
      }

      // If the effect cleanup already ran while we were in the async section above,
      // disposed is true — run cleanup immediately instead of waiting for next unmount.
      if (disposed) cleanup()
    }).catch(console.error)

    return () => {
      disposed = true
      // cleanup is null if the terminal never finished initializing (e.g. component
      // unmounted before WASM loaded). The disposed flag handles that case above.
      cleanup?.()
    }
  }, [socket]) // re-run if socket instance changes (reconnect)

  // ghostty-web needs a plain div to attach into. height/width 100% so it fills
  // whatever layout parent gives it — the FitAddon does the actual cols/rows math.
  return <div ref={containerRef} style={{ height: '100%', width: '100%' }} />
}
