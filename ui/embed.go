package ui

import "embed"

//go:generate go run concat.go

//go:embed static templates
var Content embed.FS
