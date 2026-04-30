const fs = require('fs');
const path = require('path');

function findTsFiles(dir, files = []) {
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const full = path.join(dir, item);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      findTsFiles(full, files);
    } else if (full.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

const patterns = [
  /^export\s+(?:async\s+)?function\s+(\w+)/,
  /^export\s+const\s+(\w+)\s*[:=]/,
  /^export\s+class\s+(\w+)/,
  /^export\s+interface\s+(\w+)/,
  /^export\s+type\s+(?!\*\s+from)(\w+)/,
];

const files = findTsFiles('src');
const results = [];

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) {
        // Check if previous non-empty lines contain JSDoc
        let hasJSDoc = false;
        for (let j = i - 1; j >= 0; j--) {
          const prevLine = lines[j].trim();
          if (prevLine === '') continue;
          if (prevLine.startsWith('/**')) {
            hasJSDoc = true;
            break;
          }
          if (prevLine.startsWith('//') || prevLine.startsWith('*') || prevLine.startsWith('*/')) {
            continue;
          }
          break;
        }
        if (!hasJSDoc) {
          results.push({ file, line: i + 1, name: match[1], text: line });
        }
        break;
      }
    }
  }
}

for (const r of results) {
  console.log(`${r.file}:${r.line} ${r.name}`);
}
console.log('--- Total:', results.length);
