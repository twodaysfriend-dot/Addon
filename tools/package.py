"""Build an importable Bedrock behavior pack; no Node dependencies in the archive."""
from pathlib import Path
import json
import zipfile

root = Path(__file__).resolve().parents[1]
pack = root / 'behavior_pack'
manifest = json.loads((pack / 'manifest.json').read_text())
version = '.'.join(map(str, manifest['header']['version']))
output = root / 'dist' / f'ChestHistory-{version}.mcpack'
output.parent.mkdir(exist_ok=True)
files = sorted(p for p in pack.rglob('*') if p.is_file())
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
    for file in files:
        archive.write(file, file.relative_to(pack).as_posix())
with zipfile.ZipFile(output) as archive:
    assert archive.testzip() is None
    manifest = json.loads(archive.read('manifest.json'))
    assert next(module['entry'] for module in manifest['modules'] if module['type'] == 'script') in archive.namelist()
    assert all(not name.startswith(('node_modules/', '/')) for name in archive.namelist())
print(f'Built and verified {output} ({len(files)} files, {output.stat().st_size} bytes)')
