"""Create bounded real PDF/EPUB inputs for status, identity and restoration checks."""
from pathlib import Path
from html import escape
import sys
import zipfile
import xml.etree.ElementTree as ET

folder = Path(sys.argv[1])
folder.mkdir(parents=True, exist_ok=True)
objects = [b'<< /Type /Catalog /Pages 2 0 R >>', b'<< /Type /Pages /Count 3 /Kids [4 0 R 6 0 R 8 0 R] >>', b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
for page in range(3):
    stream = f'0.15 0.3 0.5 rg 40 500 340 70 re f\n0 0 0 rg BT /F1 22 Tf 40 620 Td (Status PDF page {page + 1}) Tj ET\n'.encode()
    objects.extend([f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 700] /Resources << /Font << /F1 3 0 R >> >> /Contents {5 + page * 2} 0 R >>'.encode(), f'<< /Length {len(stream)} >>\nstream\n'.encode() + stream + b'endstream'])
pdf = bytearray(b'%PDF-1.4\n')
offsets = [0]
for index, obj in enumerate(objects, 1):
    offsets.append(len(pdf))
    pdf.extend(f'{index} 0 obj\n'.encode() + obj + b'\nendobj\n')
xref = len(pdf)
pdf.extend(f'xref\n0 {len(objects) + 1}\n0000000000 65535 f \n'.encode())
pdf.extend(b''.join(f'{offset:010} 00000 n \n'.encode() for offset in offsets[1:]))
pdf.extend(f'trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF'.encode())
(folder / 'status.pdf').write_bytes(pdf)

for filename, empty in [('status.epub', False), ('no-toc.epub', True)]:
    resources = {'META-INF/container.xml': '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'}
    manifest = ['<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>']
    spine = []
    for index in range(6):
        manifest.append(f'<item id="s{index}" href="section-{index}.xhtml" media-type="application/xhtml+xml"/>')
        spine.append(f'<itemref idref="s{index}"' + (' linear="no"' if index == 5 else '') + '/>')
        paragraphs = []
        for paragraph in range(48):
            anchor = 'opening' if paragraph == 0 else 'deep' if paragraph == 12 else 'Δ' if paragraph == 28 else f'p{paragraph}'
            if paragraph in (0, 12, 28):
                paragraphs.append(f'<h2 id="{anchor}">Section {index + 1}: passage {paragraph}</h2>')
            paragraphs.append(f'<p id="text-{paragraph}">Status section {index + 1}, paragraph {paragraph + 1}. Select and copy this publication sentence. Reliable reading location follows reflow, chapter transitions and continuous scrolling without changing publication typography.</p>')
        body = f'<h1>Reading status section {index + 1}</h1><p><a id="internal-link" href="section-3.xhtml#opening">Internal chapter destination</a></p><p><input aria-label="Publication note" value="note"/><button>Publication control</button></p>' + ''.join(paragraphs)
        resources[f'EPUB/section-{index}.xhtml'] = '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Section title</title><style>body {color:#222;background:white;font:16px/1.5 serif;margin:16px} h2 {font-size:20px}</style></head><body>' + body + '</body></html>'
    toc = '' if empty else ('<li><a href="section-0.xhtml">Chapter One</a><ol>'
        '<li><a href="section-0.xhtml#opening">Opening passage</a></li>'
        '<li><a href="section-0.xhtml#deep">Deep passage</a><ol><li><a href="section-0.xhtml#deep">Nested deep passage</a></li></ol></li>'
        '<li><a href="section-0.xhtml#%CE%94">Unicode passage</a></li>'
        '<li><a href="section-0.xhtml#%ZZ">Invalid fragment</a></li>'
        '<li><a href="section-0.xhtml#missing">Missing fragment</a></li>'
        '<li><a href="section-2.xhtml">A long labeled section within Chapter One with enough descriptive words to exercise restrained single-line truncation at narrow widths</a></li>'
        '</ol></li><li><a href="section-3.xhtml">Chapter Two</a></li><li><a href="section-4.xhtml"> </a></li>')
    resources['EPUB/nav.xhtml'] = '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol>' + toc + '</ol></nav></body></html>'
    resources['EPUB/book.opf'] = '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">clio-status-' + str(empty) + '</dc:identifier><dc:title>' + escape('Résumé & <Notes> “一”') + '</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-11-05T00:00:00Z</meta></metadata><manifest>' + ''.join(manifest) + '</manifest><spine>' + ''.join(spine) + '</spine></package>'
    for name, text in resources.items():
        ET.fromstring(text)
    with zipfile.ZipFile(folder / filename, 'w', compression=zipfile.ZIP_DEFLATED) as book:
        book.writestr('mimetype', 'application/epub+zip', compress_type=zipfile.ZIP_STORED)
        for name, text in resources.items():
            book.writestr(name, text)
(folder / 'invalid.pdf').write_bytes(b'Not a PDF')
(folder / 'invalid.epub').write_bytes(b'Not an EPUB')
