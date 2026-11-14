import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const root = resolve('behavior_pack');
const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));
assert.equal(manifest.format_version, 2);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
assert.match(manifest.header.uuid, uuid);
const script = manifest.modules.find(module => module.type === 'script');
assert.ok(script);
assert.match(script.uuid, uuid);
assert.notEqual(script.uuid, manifest.header.uuid);
assert.deepEqual(manifest.header.min_engine_version, [1, 21, 90]);
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
for (const dependency of manifest.dependencies) {
  assert.equal(dependency.version, pkg.devDependencies[dependency.module_name]);
}
const entry = resolve(root, script.entry);
assert.ok(entry.startsWith(root + '/'));
assert.ok(existsSync(entry));
const imports = [...readFileSync(entry, 'utf8').matchAll(/from ['"]([^'"]+)['"]/g)].map(match => match[1]);
for (const name of imports) {
  if (name.startsWith('.')) assert.ok(existsSync(resolve(dirname(entry), name)), `Missing script: ${name}`);
  else assert.ok(manifest.dependencies.some(dep => dep.module_name === name), `Undeclared module: ${name}`);
}
console.log('Manifest, script entry/imports, and API dependency versions validated.');
