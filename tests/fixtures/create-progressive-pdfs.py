"""Create deterministic PDFs with mixed page dimensions and visible labels."""
from pathlib import Path
import sys

folder = Path(sys.argv[1])
folder.mkdir(parents=True, exist_ok=True)

for count in (5, 100, 1000):
    objects = [b'<< /Type /Catalog /Pages 2 0 R >>', None,
               b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
    kids = []
    for index in range(count):
        page_num = index + 1
        page_obj = len(objects) + 1
        content_obj = page_obj + 1
        kids.append(f'{page_obj} 0 R'.encode())
        if page_num % 4 == 0:
            width, height = 900, 500
        elif page_num % 3 == 0:
            width, height = 500, 900
        else:
            width, height = 420 + (page_num % 7) * 20, 650 + (page_num % 5) * 30
        stream = f'BT /F1 24 Tf 48 80 Td (Benchmark page {page_num}) Tj ET\n'.encode()
        objects.extend([
            f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {width} {height}] /Resources << /Font << /F1 3 0 R >> >> /Contents {content_obj} 0 R >>'.encode(),
            f'<< /Length {len(stream)} >>\nstream\n'.encode() + stream + b'endstream',
        ])
    objects[1] = b'<< /Type /Pages /Count ' + str(count).encode() + b' /Kids [' + b' '.join(kids) + b'] >>'
    data = bytearray(b'%PDF-1.4\n')
    offsets = [0]
    for number, obj in enumerate(objects, 1):
        offsets.append(len(data))
        data.extend(f'{number} 0 obj\n'.encode() + obj + b'\nendobj\n')
    xref = len(data)
    data.extend(f'xref\n0 {len(objects) + 1}\n0000000000 65535 f \n'.encode())
    data.extend(b''.join(f'{offset:010} 00000 n \n'.encode() for offset in offsets[1:]))
    data.extend(f'trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF'.encode())
    (folder / f'progressive-{count}.pdf').write_bytes(data)
