.PHONY: install generate wasm dev build clean

MESHCORE_GO ?= ../meshcore-go
# Set for GitHub project pages, e.g. BASE_PATH=/meshcore-packet-tool/
BASE_PATH ?=

WASM_OUT    := web/public/meshcore.wasm
WASM_EXEC   := web/public/wasm_exec.js
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

## wasm: generate TS interfaces, compile Go → WebAssembly, copy wasm_exec.js
wasm: generate
	GOOS=js GOARCH=wasm go build -o $(WASM_OUT) ./wasm
	cp "$$(go env GOROOT)/lib/wasm/wasm_exec.js" $(WASM_EXEC)
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
