import { readFileSync, writeFileSync } from 'node:fs'

// Panda leaves spaces on the otherwise empty variant line for this Tocyn layout recipe.
const file = new URL('../src/styles/generated/recipes/auth-shell.d.ts', import.meta.url)
const source = readFileSync(file, 'utf8')
const normalized = source.replace(/^[\t ]+$/gm, '').replace(/\n?$/, '\n')
if (normalized !== source) writeFileSync(file, normalized)
