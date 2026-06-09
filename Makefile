.PHONY: install dev build clean help

# Set for GitHub project pages, e.g. BASE_PATH=/meshcore-packet-tool/
BASE_PATH ?=

## install: install npm dependencies
install:
	npm install

## dev: start Vite dev server
dev: install
	npm run dev

## build: produce a static bundle (set BASE_PATH for GitHub Pages)
build: install
	BASE_PATH=$(BASE_PATH) npm run build
	@touch dist/.nojekyll

## clean: remove build artifacts
clean:
	rm -rf dist node_modules

## help: show this message
help:
	@grep -E '^##' Makefile | sed 's/## //'
