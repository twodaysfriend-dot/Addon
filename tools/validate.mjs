import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, sep } from 'node:path';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const packUuids = new Set();

for (const directory of ['behavior_pack', 'quirk_pack']) {
  const root = resolve(directory);
  const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.format_version, 2);
  assert.deepEqual(manifest.header.min_engine_version, [1, 21, 90]);
  if (directory === 'behavior_pack') {
    assert.deepEqual(manifest.header.version, pkg.version.split('.').map(Number));
  }
  for (const part of [manifest.header, ...manifest.modules]) {
    assert.match(part.uuid, uuid);
    assert.ok(!packUuids.has(part.uuid), `Duplicate pack UUID: ${part.uuid}`);
    packUuids.add(part.uuid);
    assert.deepEqual(part.version, manifest.header.version);
  }
  for (const dependency of manifest.dependencies) {
    assert.ok(Object.hasOwn(pkg.devDependencies, dependency.module_name), `Unexpected dependency: ${JSON.stringify(dependency)}`);
    assert.equal(dependency.version, pkg.devDependencies[dependency.module_name]);
  }

  const script = manifest.modules.find(module => module.type === 'script');
  assert.ok(script);
  const checked = new Set();
  function checkScript(entry) {
    assert.ok(entry.startsWith(root + sep), `Script outside ${directory}: ${entry}`);
    assert.ok(existsSync(entry), `Missing script: ${entry}`);
    if (checked.has(entry)) return;
    checked.add(entry);
    const imports = readFileSync(entry, 'utf8').matchAll(/(?:from\s+|^\s*import\s*)['"]([^'"]+)['"]/gm);
    for (const [, name] of imports) {
      if (name.startsWith('.')) checkScript(resolve(dirname(entry), name));
      else assert.ok(manifest.dependencies.some(dep => dep.module_name === name), `Undeclared module: ${name}`);
    }
  }
  checkScript(resolve(root, script.entry));
  console.log(`Validated manifest, UUIDs, script imports and API dependencies for ${directory}.`);
}
