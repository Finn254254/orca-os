SHELL := /usr/bin/env bash

.PHONY: test image vm

test:
	./tests/run.sh

image:
	./build/build-image.sh

vm:
	./vm/run-qemu.sh
