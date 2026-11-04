"""Create self-contained PDF/EPUB inputs for real reader feedback regressions."""
from pathlib import Path
import sys
import zipfile

folder = Path(sys.argv[1])
folder.mkdir(parents=True, exist_ok=True)
count = 120
objects = [
    b"<< /Type /Catalog /Pages 2 0 R >>",
    f"<< /Type /Pages /Count {count} /Kids [".encode()
    + b" ".join(f"{4 + page * 2} 0 R".encode() for page in range(count)) + b"] >>",
    b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
]
for page in range(count):
    content = f"BT /F1 24 Tf 54 730 Td (Feedback PDF page {page + 1}) Tj ET\n"
    content += "0.2 0.35 0.6 rg 54 675 504 22 re f 0 0 0 rg\n"
    content += "\n".join(
        f"BT /F1 13 Tf 54 {640 - line * 26} Td (Paragraph {line + 1}: needle, readable document content.) Tj ET"
        for line in range(19)
    )
    stream = content.encode()
    objects.extend([
        f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents {5 + page * 2} 0 R >>".encode(),
        f"<< /Length {len(stream)} >>\nstream\n".encode() + stream + b"\nendstream",
    ])
pdf = bytearray(b"%PDF-1.4\n")
offsets = [0]
for index, obj in enumerate(objects, 1):
    offsets.append(len(pdf))
    pdf.extend(f"{index} 0 obj\n".encode() + obj + b"\nendobj\n")
xref = len(pdf)
pdf.extend(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode())
pdf.extend(b"".join(f"{offset:010} 00000 n \n".encode() for offset in offsets[1:]))
pdf.extend(f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF".encode())
(folder / "feedback.pdf").write_bytes(pdf)

with zipfile.ZipFile(folder / "feedback.epub", "w") as book:
    book.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
    book.writestr("META-INF/container.xml", '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
    book.writestr("book.opf", '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">clio-feedback-fixture</dc:identifier><dc:title>Feedback EPUB</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-11-04T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>')
    book.writestr("nav.xhtml", '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="c1.xhtml">First retained chapter</a></li><li><a href="c2.xhtml">Second retained chapter</a></li></ol></nav></body></html>')
    for chapter in (1, 2):
        book.writestr(f"c{chapter}.xhtml", '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Feedback chapter</title><style>body {color:#222;background:white;line-height:1.6}</style></head><body>' + f"<h1>Feedback EPUB chapter {chapter}</h1>" + '<p>Retained book content: a busy reading page must not make error feedback unreadable.</p>' * 35 + '</body></html>')

(folder / "invalid.pdf").write_bytes(b"Not a PDF: disposable feedback fixture.")
(folder / "invalid.epub").write_bytes(b"Not an EPUB: disposable feedback fixture.")
