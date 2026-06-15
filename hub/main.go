package main

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
	"os"
	"sync"

	"github.com/gorilla/websocket"
	"github.com/joho/godotenv"
)

//go:embed static_dist
var staticFiles embed.FS

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type Hub struct {
	mu          sync.Mutex
	daemon      *websocket.Conn
	daemonCtrl  *websocket.Conn
	frontend    *websocket.Conn
}

var hub = &Hub{}

func main() {
	_ = godotenv.Load("../.env")

	port := os.Getenv("HUB_WEB_PORT")
	if port == "" {
		port = "5000"
	}

	sub, err := fs.Sub(staticFiles, "static_dist")
	if err != nil {
		log.Fatal(err)
	}
	http.Handle("/", http.FileServer(http.FS(sub)))
	http.HandleFunc("/ws/daemon", handleDaemon)
	http.HandleFunc("/ws/daemon-ctrl", handleDaemonCtrl)
	http.HandleFunc("/ws/frontend", handleFrontend)
	http.HandleFunc("/ws/control", handleControl)

	log.Printf("hub listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}

func handleDaemon(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("daemon upgrade:", err)
		return
	}
	hub.mu.Lock()
	hub.daemon = conn
	hub.mu.Unlock()
	log.Println("daemon data connected")

	defer func() {
		hub.mu.Lock()
		hub.daemon = nil
		hub.mu.Unlock()
		conn.Close()
		log.Println("daemon data disconnected")
	}()

	for {
		mt, msg, err := conn.ReadMessage()
		if err != nil {
			break
		}
		hub.mu.Lock()
		fe := hub.frontend
		hub.mu.Unlock()
		if fe != nil {
			if err := fe.WriteMessage(mt, msg); err != nil {
				log.Println("write to frontend:", err)
			}
		}
	}
}

func handleDaemonCtrl(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("daemon-ctrl upgrade:", err)
		return
	}
	hub.mu.Lock()
	hub.daemonCtrl = conn
	hub.mu.Unlock()
	log.Println("daemon ctrl connected")

	defer func() {
		hub.mu.Lock()
		hub.daemonCtrl = nil
		hub.mu.Unlock()
		conn.Close()
		log.Println("daemon ctrl disconnected")
	}()

	// drain (daemon never sends on ctrl channel)
	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			break
		}
	}
}

func handleFrontend(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("frontend upgrade:", err)
		return
	}
	hub.mu.Lock()
	hub.frontend = conn
	hub.mu.Unlock()
	log.Println("frontend connected")

	defer func() {
		hub.mu.Lock()
		hub.frontend = nil
		hub.mu.Unlock()
		conn.Close()
		log.Println("frontend disconnected")
	}()

	for {
		mt, msg, err := conn.ReadMessage()
		if err != nil {
			break
		}
		hub.mu.Lock()
		d := hub.daemon
		hub.mu.Unlock()
		if d != nil {
			if err := d.WriteMessage(mt, msg); err != nil {
				log.Println("write to daemon:", err)
			}
		}
	}
}

func handleControl(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("control upgrade:", err)
		return
	}
	log.Println("control connected")

	defer func() {
		conn.Close()
		log.Println("control disconnected")
	}()

	// route control frames -> daemon ctrl channel (never touches data stream)
	for {
		mt, msg, err := conn.ReadMessage()
		if err != nil {
			break
		}
		hub.mu.Lock()
		dc := hub.daemonCtrl
		hub.mu.Unlock()
		if dc != nil {
			if err := dc.WriteMessage(mt, msg); err != nil {
				log.Println("write control to daemon-ctrl:", err)
			}
		}
	}
}
