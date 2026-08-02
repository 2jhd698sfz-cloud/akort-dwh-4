const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const sourceDir = path.join(root, 'src');
const files = fs.readdirSync(sourceDir).filter(file => /\.js$/.test(file)).sort();
const sources = files.map(file => ({
  file,
  source: fs.readFileSync(path.join(sourceDir, file), 'utf8')
}));
for (const item of sources) new vm.Script(item.source, { filename: item.file });
const combined = sources.map(item => item.source).join('\n');

const declarations = new Set(
  Array.from(combined.matchAll(/function\s+([A-Za-z_$][\w$]*_)\s*\(/g), match => match[1])
);

for (const match of combined.matchAll(/(?:var|let|const)\s+([A-Za-z_$][\w$]*_)\s*=\s*(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/g)) {
  declarations.add(match[1]);
}

const calls = new Set(
  Array.from(combined.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*_)\s*\(/g), match => match[1])
);
const unresolved = Array.from(calls).filter(name => !declarations.has(name)).sort();

assert.deepEqual(
  unresolved,
  [],
  `Undefined Apps Script private function calls: ${unresolved.join(', ')}`
);

console.log(JSON.stringify({
  suite: 'apps_script_private_references_static',
  sourceFiles: files.length,
  syntaxCheckedFiles: sources.length,
  privateDeclarations: declarations.size,
  privateCalls: calls.size,
  unresolved: unresolved.length
}, null, 2));
