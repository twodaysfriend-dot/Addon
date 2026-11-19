"""Build the chest behavior pack and the two-pack quirks add-on."""
from io import BytesIO
import json
from pathlib import Path
import struct
from zipfile import ZIP_DEFLATED, ZipFile

root = Path(__file__).resolve().parents[1]
dist = root / 'dist'


def pack(directory):
    source = root / directory
    archive_bytes = BytesIO()
    files = sorted(path for path in source.rglob('*') if path.is_file())
    with ZipFile(archive_bytes, 'w', ZIP_DEFLATED) as archive:
        for file in files:
            archive.write(file, file.relative_to(source).as_posix())
    with ZipFile(archive_bytes) as archive:
        assert archive.testzip() is None
        assert all(not name.startswith(('node_modules/', '/')) for name in archive.namelist())
        manifest = json.loads(archive.read('manifest.json'))
        for module in manifest['modules']:
            if module['type'] == 'script':
                assert module['entry'] in archive.namelist()
    return archive_bytes.getvalue(), manifest


def version(manifest):
    return '.'.join(map(str, manifest['header']['version']))


dist.mkdir(exist_ok=True)
chest_pack, chest_manifest = pack('behavior_pack')
chest_path = dist / f'ChestHistory-{version(chest_manifest)}.mcpack'
chest_path.write_bytes(chest_pack)
print(f'Built and verified {chest_path} ({len(chest_pack)} bytes)')

behavior_pack, behavior_manifest = pack('quirk_pack')
resource_pack, resource_manifest = pack('quirk_resources')
resource_header = resource_manifest['header']
assert {'uuid': resource_header['uuid'], 'version': resource_header['version']} in behavior_manifest['dependencies']
assert version(behavior_manifest) == version(resource_manifest)

with ZipFile(BytesIO(behavior_pack)) as behavior, ZipFile(BytesIO(resource_pack)) as resources:
    sword = json.loads(behavior.read('items/stain_sword.json'))['minecraft:item']
    icon = sword['components']['minecraft:icon']['textures']['default']
    atlas = json.loads(resources.read('textures/item_texture.json'))['texture_data']
    texture = resources.read(atlas[icon]['textures'] + '.png')
    assert texture.startswith(b'\x89PNG\r\n\x1a\n')
    assert struct.unpack('>IIBB', texture[16:26]) == (256, 256, 8, 6)  # 8-bit RGBA

    particle_ids = set()
    for filename in resources.namelist():
        if not filename.startswith('particles/') or not filename.endswith('.json'):
            continue
        effect = json.loads(resources.read(filename))['particle_effect']
        identifier = effect['description']['identifier']
        assert identifier not in particle_ids
        particle_ids.add(identifier)
        texture_path = effect['description']['basic_render_parameters']['texture']
        texture = resources.read(texture_path + '.png')
        assert texture.startswith(b'\x89PNG\r\n\x1a\n')
        width, height = struct.unpack('>II', texture[16:24])
        uv = effect['components']['minecraft:particle_appearance_billboard']['uv']
        assert (uv['texture_width'], uv['texture_height']) == (width, height)
        x, y = uv['uv']
        tile_width, tile_height = uv['uv_size']
        assert 0 <= x < x + tile_width <= width
        assert 0 <= y < y + tile_height <= height
    assert particle_ids == {f'mha:{name}' for name in ('blood', 'drive', 'burst', 'frost', 'volt', 'flame', 'void', 'spark')}

addon = dist / f'MHAQuirks-{version(behavior_manifest)}.mcaddon'
with ZipFile(addon, 'w') as archive:
    archive.writestr('MHAQuirks-Behavior.mcpack', behavior_pack)
    archive.writestr('MHAQuirks-Resources.mcpack', resource_pack)
with ZipFile(addon) as archive:
    assert archive.testzip() is None
print(f'Built and verified {addon} ({addon.stat().st_size} bytes)')
