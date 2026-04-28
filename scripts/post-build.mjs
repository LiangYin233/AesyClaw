import { readFileSync, writeFileSync } from 'node:fs';

const file = 'dist/index.js';
let content = readFileSync(file, 'utf8');
content = content.replaceAll('from "sqlite"', 'from "node:sqlite"');
writeFileSync(file, content);
console.log('Patched node:sqlite imports in', file);
