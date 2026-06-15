package main

import (
	"encoding/json"
	"io"
	"log"
	"os"
	"os/exec"
	"time"

	"github.com/creack/pty"
	"github.com/gorilla/websocket"
	"github.com/joho/godotenv"
)

type controlMsg struct {
	Event string `json:"event"`
	Cols  uint16 `json:"cols"`
	Rows  uint16 `json:"rows"`
}

func hubURL(port, path string) string {
	return "ws://localhost:" + port + path
}

func main() {
	_ = godotenv.Load("../.env")

	port := os.Getenv("HUB_WEB_PORT")
	if port == "" {
		port = "5000"
	}
	shell := os.Getenv("DAEMON_SHELL")
	if shell == "" {
		shell = "/bin/bash"
	}

	// connect data channel
	dataConn, _, err := websocket.DefaultDialer.Dial(hubURL(port, "/ws/daemon"), nil)
	if err != nil {
		log.Fatal("dial data:", err)
	}
	defer dataConn.Close()

	// connect control channel
	ctrlConn, _, err := websocket.DefaultDialer.Dial(hubURL(port, "/ws/daemon-ctrl"), nil)
	if err != nil {
		log.Fatal("dial control:", err)
	}
	defer ctrlConn.Close()

	// start PTY
	cmd := exec.Command(shell)
	// TERM=xterm advertises only 8 colors via terminfo, so terminfo-aware apps
	// (p10k, vim, ls) fall back to a reduced palette regardless of the frontend
	// renderer's capabilities. xterm-256color advertises 256, and COLORTERM=truecolor
	// lets apps that check it emit 24-bit RGB. A UTF-8 locale is required for the
	// Nerd Font / powerline glyphs p10k draws to have correct width.
	cmd.Env = append(os.Environ(),
		"TERM=xterm-256color",
		"COLORTERM=truecolor",
		"LANG=C.UTF-8",
		"LC_CTYPE=C.UTF-8",
	)
	ptmx, err := pty.Start(cmd)
	if err != nil {
		log.Fatal("pty start:", err)
	}
	defer ptmx.Close()

	log.Printf("daemon started: shell=%s", shell)

	// PTY -> data websocket
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := ptmx.Read(buf)
			if n > 0 {
				if err2 := dataConn.WriteMessage(websocket.BinaryMessage, buf[:n]); err2 != nil {
					log.Println("write pty->ws:", err2)
					return
				}
			}
			if err != nil {
				if err != io.EOF {
					log.Println("pty read:", err)
				}
				return
			}
		}
	}()

	// data websocket -> PTY stdin
	go func() {
		for {
			_, msg, err := dataConn.ReadMessage()
			if err != nil {
				log.Println("data ws read:", err)
				return
			}
			if _, err := ptmx.Write(msg); err != nil {
				log.Println("pty write:", err)
				return
			}
		}
	}()

	// control websocket -> resize
	go func() {
		for {
			_, msg, err := ctrlConn.ReadMessage()
			if err != nil {
				log.Println("control ws read:", err)
				return
			}
			var cm controlMsg
			if err := json.Unmarshal(msg, &cm); err != nil {
				log.Println("control parse:", err)
				continue
			}
			if cm.Event == "resize" && cm.Cols > 0 && cm.Rows > 0 {
				_ = pty.Setsize(ptmx, &pty.Winsize{Cols: cm.Cols, Rows: cm.Rows})
			}
		}
	}()

	// wait for shell to exit
	_ = cmd.Wait()
	time.Sleep(500 * time.Millisecond)
	log.Println("daemon exiting")
}
