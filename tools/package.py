"""Build standalone Bedrock behavior packs."""
import json
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parents[1]


def build(directory, name):
    pack = root / directory
    manifest = json.loads((pack / 'manifest.json').read_text())
    version = '.'.join(map(str, manifest['header']['version']))
    output = root / 'dist' / f'{name}-{version}.mcpack'
    output.parent.mkdir(exist_ok=True)
    files = sorted(p for p in pack.rglob('*') if p.is_file())
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for file in files:
            archive.write(file, file.relative_to(pack).as_posix())
    with zipfile.ZipFile(output) as archive:
        assert archive.testzip() is None
        script = next(module for module in manifest['modules'] if module['type'] == 'script')
        assert script['entry'] in archive.namelist()
        assert all(not name.startswith(('node_modules/', '/')) for name in archive.namelist())
    print(f'Built and verified {output} ({len(files)} files, {output.stat().st_size} bytes)')


build('behavior_pack', 'ChestHistory')
build('quirk_pack', 'MHAQuirks')
