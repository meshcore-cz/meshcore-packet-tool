.PHONY: install generate wasm dev build clean

MESHCORE_GO ?= ../meshcore-go
# Set for GitHub project pages, e.g. BASE_PATH=/meshcore-packet-tool/
BASE_PATH ?=

WASM_OUT    := web/public/meshpkt.wasm
WASM_EXEC   := web/public/wasm_exec.js
TINYGO      ?= tinygo
# -opt=z needs wasm-opt (binaryen). TinyGo 0.39+ for Go 1.25.
TS_GEN      := web/src/lib/wasm.gen.ts

## install: link local meshcore-go SDK (required before first build)
install:
	@test -f "$(MESHCORE_GO)/go.mod" || { \
		echo "meshcore-go not found at $(MESHCORE_GO)"; \
		echo "Clone it next to this repo, e.g.:"; \
		echo "  git clone https://github.com/meshcore-cz/meshcore-go.git $(MESHCORE_GO)"; \
		exit 1; \
	}
	go mod edit -replace=github.com/meshcore-cz/meshcore-go=$(MESHCORE_GO)
	go mod tidy
	@echo "Using meshcore-go from $(MESHCORE_GO)"

## generate: regenerate TypeScript interfaces from meshpkt.Ops
generate: install
	go run ./cmd/gen-ts -out $(TS_GEN)
	@echo "Generated $(TS_GEN)"

## wasm: generate TS interfaces, TinyGo → WebAssembly, copy wasm_exec.js
wasm: generate
	@command -v $(TINYGO) >/dev/null || { \
		echo "TinyGo not found — install: https://tinygo.org/getting-started/"; \
		exit 1; \
	}
	$(TINYGO) build -target=wasm -no-debug -opt=z -panic=trap -o $(WASM_OUT) ./cmd/meshpkt-wasm-lite
	cp "$$($(TINYGO) env TINYGOROOT)/targets/wasm_exec.js" $(WASM_EXEC)
	@echo "Built $(WASM_OUT) ($$(du -sh $(WASM_OUT) | cut -f1))"

## dev: build WASM then start Vite dev server
dev: wasm
	cd web && npm install && npm run dev

## build: build WASM then produce a static Vite bundle (set BASE_PATH for GitHub Pages)
build: wasm
	cd web && npm install && BASE_PATH=$(BASE_PATH) npm run build
	@touch web/dist/.nojekyll

## clean: remove build artifacts
clean:
	rm -f $(WASM_OUT) $(WASM_EXEC)
	rm -rf web/dist web/node_modules

## help: show this message
help:
	@grep -E '^##' Makefile | sed 's/## //'
