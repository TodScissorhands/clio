"""Create a deterministic, self-contained 64-spine EPUB 3 lifecycle input."""
from pathlib import Path
import sys
import xml.etree.ElementTree as ET
import zipfile

folder = Path(sys.argv[1])
folder.mkdir(parents=True, exist_ok=True)
count = 64
resources = {
    "META-INF/container.xml": '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    "EPUB/style.css": "html { background: white; color: #222; } body { margin: 16px; font: 16px/1.5 serif; } main { min-height: 720px; } h1 { font-size: 24px; }",
}
manifest = ['<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>', '<item id="style" href="style.css" media-type="text/css"/>']
spine = []
links = []
for index in range(count):
    name = f"chapter-{index:02}.xhtml"
    label = f"Lifecycle chapter {index + 1:02}"
    manifest.append(f'<item id="c{index}" href="{name}" media-type="application/xhtml+xml"/>')
    spine.append(f'<itemref idref="c{index}"/>')
    links.append(f'<li><a href="{name}#start">{label}</a></li>')
    resources[f"EPUB/{name}"] = ('<html xmlns="http://www.w3.org/1999/xhtml"><head>'
        f'<title>{label}</title><link rel="stylesheet" href="style.css"/></head><body><main>'
        f'<h1 id="start">{label}</h1>'
        + ''.join(f'<p>Section {index + 1}, paragraph {paragraph + 1}: deterministic embedded document keyboard ownership, forward reading and reversal.</p>' for paragraph in range(3))
        + '</main></body></html>')
resources["EPUB/book.opf"] = ('<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
    '<dc:identifier id="id">clio-epub-keyboard-lifecycle-64</dc:identifier><dc:title>Keyboard lifecycle 64</dc:title><dc:language>en</dc:language>'
    '<meta property="dcterms:modified">2026-11-05T00:00:00Z</meta></metadata><manifest>' + ''.join(manifest)
    + '</manifest><spine>' + ''.join(spine) + '</spine></package>')
resources["EPUB/nav.xhtml"] = ('<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head>'
    '<body><nav epub:type="toc"><h1>Contents</h1><ol>' + ''.join(links) + '</ol></nav></body></html>')
# Parse every XML resource before writing; no external assets or dependencies.
for name, content in resources.items():
    if name.endswith((".xml", ".opf", ".xhtml")):
        ET.fromstring(content)
with zipfile.ZipFile(folder / "lifecycle.epub", "w", compression=zipfile.ZIP_DEFLATED) as book:
    book.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
    for name, content in resources.items():
        book.writestr(name, content)
(folder / "invalid.epub").write_bytes(b"Not an EPUB: invalid replacement must retain the current reader.")
