//go:build ignore

// concat.go - Concatenates JavaScript source files into app.js
// Usage: go run concat.go

package main

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
)

func main() {
	srcDir := "static/js/src"
	outFile := "static/js/app.js"

	files, err := filepath.Glob(filepath.Join(srcDir, "*.js"))
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error finding source files: %v\n", err)
		os.Exit(1)
	}

	if len(files) == 0 {
		fmt.Fprintf(os.Stderr, "No .js files found in %s\n", srcDir)
		os.Exit(1)
	}

	sort.Strings(files) // Sort by filename (00-, 01-, ...)

	out, err := os.Create(outFile)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error creating output file: %v\n", err)
		os.Exit(1)
	}
	defer out.Close()

	out.WriteString("// Auto-generated from src/*.js - DO NOT EDIT\n")
	out.WriteString("// Run 'make app' or 'go generate ./ui' to rebuild\n\n")

	for _, f := range files {
		content, err := os.ReadFile(f)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error reading %s: %v\n", f, err)
			os.Exit(1)
		}

		out.WriteString(fmt.Sprintf("// === %s ===\n", filepath.Base(f)))
		out.Write(content)
		out.WriteString("\n\n")
	}

	fmt.Printf("Generated %s from %d files\n", outFile, len(files))
}
