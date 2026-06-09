// TinyGo browser WASM entrypoint.
//
// TinyGo //export cannot return strings to JS (WASM only allows numeric returns).
// Register a single JS callback instead; the frontend calls meshpktCall(op, argsJSON).
//
// Build:
//   tinygo build -target=wasm -no-debug -opt=z -panic=trap \
//     -o web/public/meshpkt.wasm ./cmd/meshpkt-wasm-lite
//
// Copy TinyGo's wasm_exec.js:
//   cp "$(tinygo env TINYGOROOT)/targets/wasm_exec.js" web/public/
package main

import (
	"syscall/js"

	"github.com/meshcore-cz/meshpkt"
)

func main() {
	js.Global().Set("meshpktCall", js.FuncOf(func(_ js.Value, args []js.Value) any {
		if len(args) < 2 {
			return js.Global().Get("JSON").Call("parse", `{"error":"meshpktCall: need opName and argsJSON"}`)
		}
		out := meshpkt.CallJSON(args[0].String(), args[1].String())
		return js.Global().Get("JSON").Call("parse", out)
	}))
	<-make(chan struct{}) // block forever
}
