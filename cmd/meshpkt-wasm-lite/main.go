// TinyGo browser WASM entrypoint.
//
// Build:
//   tinygo build -target=wasm -no-debug -opt=z -panic=trap \
//     -o web/public/meshpkt.wasm ./cmd/meshpkt-wasm-lite
//
// Copy TinyGo's wasm_exec.js:
//   cp "$(tinygo env TINYGOROOT)/targets/wasm_exec.js" web/public/
package main

import "github.com/meshcore-cz/meshcore-go/meshpkt"

func main() {}

//export call
func call(opName, argsJSON string) string {
	return meshpkt.CallJSON(opName, argsJSON)
}
