"""Real publications with bounded typography, protected content and layout variants."""
from pathlib import Path
import runpy
import sys
import zipfile
import xml.etree.ElementTree as ET

folder = Path(sys.argv[1])
folder.mkdir(parents=True, exist_ok=True)
runpy.run_path(str(Path(__file__).with_name('create-reader-status-documents.py')), run_name='__main__')

for filename, layout in [('preferences.epub', 'reflowable'), ('replacement.epub', 'reflowable'), ('fixed.epub', 'pre-paginated'), ('mixed.epub', 'mixed'), ('vertical.epub', 'vertical')]:
    body_size = 18 if filename == 'replacement.epub' else 20
    resources = {'META-INF/container.xml': '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'}
    manifest = ['<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>']
    spine = []
    for index in range(2):
        manifest.append(f'<item id="s{index}" href="section-{index}.xhtml" media-type="application/xhtml+xml"/>')
        fixed_property = ' properties="rendition:layout-pre-paginated"' if layout == 'mixed' and index == 1 else ''
        spine.append(f'<itemref idref="s{index}"{fixed_property}/>')
        examples = '''<h1 id="heading">Publisher hierarchy</h1>
<p id="inherited">Inherited prose size and face.</p><p id="em" style="font-size:1.1em">Relative em prose.</p>
<p id="rem" style="font-size:1.2rem">Relative rem prose.</p><p id="px" style="font-size:18px">Absolute pixel prose.</p>
<p id="inline" style="font:17px/1.5 monospace">Inline publisher face and size.</p>
<pre id="code">const untouched = 1;
  indent();</pre><div class="verse"><p id="verse" style="font:17px/1.4 serif">First verse line<br/>Second verse line</p></div>
<p id="manual" style="font-size:17px">Manual first line<br/>Manual second line</p>
<p id="whitespace" style="font:15px/1.4 monospace;white-space:pre-wrap">Preserved   spaces
  and indentation</p><p id="inline-code" style="font-size:16px">Literal <code>value = 1</code></p>
<table id="table"><tr><td>Table cells</td></tr></table>
<img id="image" width="120" height="60" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='60'%3E%3Crect width='120' height='60' fill='blue'/%3E%3C/svg%3E"/>
<math xmlns="http://www.w3.org/1998/Math/MathML" id="math"><mi>x</mi><mo>=</mo><mn>2</mn></math>
<p dir="rtl" id="rtl">قراءة مريحة واتجاه محفوظ</p><form><input id="note" value="note"/><button>Publication control</button></form>
<p><a id="internal-link" href="section-1.xhtml#p20">Internal destination</a></p>'''
        paragraphs = ''.join(f'<p id="p{i}">Section {index + 1}, passage {i}. Select and copy this ordinary publication sentence safely. Reflow preserves this passage while reading preferences change. <em>Emphasis</em> and <strong>strong text</strong> survive.</p>' for i in range(64))
        writing = 'html {writing-mode:vertical-rl}' if layout == 'vertical' else ''
        resources[f'EPUB/section-{index}.xhtml'] = f'''<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Preference fixture</title><meta name="viewport" content="width=800,height=600"/><style>
body {{font:{body_size}px/1.5 serif;color:#222;background:white;margin:16px}} h1{{font-size:2em}}
pre{{font:14px/1.2 monospace;white-space:pre;background:#eee;color:#222}} table{{width:240px}} td{{font:16px/1.5 serif}}
.verse{{white-space:pre-line}} {writing}</style><style id="epubjs-inserted-css-clio-reading-preferences">.publisher-owned {{ color: #135; }}</style></head>
<body style="font-size:{body_size}px!important;font-family:serif!important">{examples}{paragraphs}</body></html>'''
    resources['EPUB/nav.xhtml'] = '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="section-0.xhtml">Chapter One</a><ol><li><a href="section-0.xhtml#p20">Deep passage</a></li></ol></li><li><a href="section-1.xhtml">Chapter Two</a></li></ol></nav></body></html>'
    layout_meta = '<meta property="rendition:layout">pre-paginated</meta>' if layout == 'pre-paginated' else ''
    resources['EPUB/book.opf'] = f'<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">clio-preferences-{filename}</dc:identifier><dc:title>Reading preferences</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-11-05T00:00:00Z</meta>{layout_meta}</metadata><manifest>{"".join(manifest)}</manifest><spine>{"".join(spine)}</spine></package>'
    for text in resources.values():
        ET.fromstring(text)
    with zipfile.ZipFile(folder / filename, 'w', compression=zipfile.ZIP_DEFLATED) as book:
        book.writestr('mimetype', 'application/epub+zip', compress_type=zipfile.ZIP_STORED)
        for name, text in resources.items():
            book.writestr(name, text)
