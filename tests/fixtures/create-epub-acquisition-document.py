"""Write deterministic three-section EPUBs with real CSS and PNG archive assets."""
import base64
from pathlib import Path
import sys
import xml.etree.ElementTree as ET
import zipfile

folder = Path(sys.argv[1])
folder.mkdir(parents=True, exist_ok=True)
png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=")


def write_book(name, label, missing_nav=False):
    resources = {
        "META-INF/container.xml": '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
        "EPUB/style.css": 'html { background: white; color: #222; } body { margin: 16px; font: 16px/1.5 serif; } h1 { font-size: 24px; } .asset { background-image: url("pixel.png"); } img { width: 8px; height: 8px; }',
        "EPUB/pixel.png": png,
        "EPUB/broken.json": "{invalid archive JSON",
    }
    manifest = ['<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>', '<item id="style" href="style.css" media-type="text/css"/>', '<item id="pixel" href="pixel.png" media-type="image/png"/>']
    spine = []
    links = []
    for index in range(3):
        member = f"chapter-{index + 1}.xhtml"
        title = f"Acquisition {label} chapter {index + 1}"
        manifest.append(f'<item id="c{index}" href="{member}" media-type="application/xhtml+xml"/>')
        spine.append(f'<itemref idref="c{index}"/>')
        links.append(f'<li><a href="{member}#start">{title}</a></li>')
        resources[f"EPUB/{member}"] = ('<html xmlns="http://www.w3.org/1999/xhtml"><head>'
            f'<title>{title}</title><link rel="stylesheet" href="style.css"/></head><body>'
            f'<h1 id="start">{title}</h1><p id="cfi">CFI sentence for book {label} section {index + 1}.</p>'
            '<p class="asset">Real archive stylesheet and image replacements.</p><img src="pixel.png" alt="Archive pixel"/>'
            + ''.join(f'<p>Paragraph {paragraph + 1} of the real acquisition fixture: reliable publication retirement and replacement.</p>' for paragraph in range(8))
            + '</body></html>')
    resources["EPUB/book.opf"] = ('<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
        f'<dc:identifier id="id">clio-acquisition-{label}</dc:identifier><dc:title>Acquisition {label}</dc:title><dc:language>en</dc:language>'
        '<meta property="dcterms:modified">2026-11-07T00:00:00Z</meta><meta property="rendition:layout">reflowable</meta></metadata><manifest>'
        + ''.join(manifest) + '</manifest><spine>' + ''.join(spine) + '</spine></package>')
    if not missing_nav:
        resources["EPUB/nav.xhtml"] = ('<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head>'
            '<body><nav epub:type="toc"><ol>' + ''.join(links) + '</ol></nav></body></html>')
    for member, content in resources.items():
        if member.endswith((".xml", ".opf", ".xhtml")):
            ET.fromstring(content)
    with zipfile.ZipFile(folder / name, "w", compression=zipfile.ZIP_DEFLATED) as book:
        book.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        for member, content in resources.items():
            book.writestr(member, content)


write_book("acquisition-a.epub", "A")
write_book("acquisition-b.epub", "B")
write_book("missing-nav.epub", "Missing navigation", missing_nav=True)
(folder / "invalid.epub").write_bytes(b"Not a ZIP archive or an EPUB publication.")
