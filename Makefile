.PHONY: install dev build clean help

# Set for GitHub project pages, e.g. BASE_PATH=/meshcore-packet-tool/
BASE_PATH ?=

## install: install npm dependencies
install:
	cd web && npm install

## dev: start Vite dev server
dev: install
	cd web && npm run dev

## build: produce a static Vite bundle (set BASE_PATH for GitHub Pages)
build: install
	cd web && BASE_PATH=$(BASE_PATH) npm run build
	@touch web/dist/.nojekyll

## clean: remove build artifacts
clean:
	rm -rf web/dist web/node_modules

## help: show this message
help:
	@grep -E '^##' Makefile | sed 's/## //'
