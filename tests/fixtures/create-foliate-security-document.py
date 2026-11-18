"""Build a malicious publication containing the exact G1C meta-refresh payload."""
from pathlib import Path
import os
import runpy
import sys
import zipfile

folder = Path(sys.argv[1])
runpy.run_path(str(Path(__file__).with_name("create-epub-acquisition-document.py")))
with zipfile.ZipFile(folder / "acquisition-a.epub") as source:
    members = {name: source.read(name) for name in source.namelist()}
chapter = members["EPUB/chapter-1.xhtml"].decode()
chapter = chapter.replace("</head>", '<meta http-equiv="refresh" content="0;url=../bootstrap.html" />'
    '<script>parent.document.body.dataset.publicationCanary="executed"</script></head>')
origin = os.environ.get("CLIO_SECURITY_ORIGIN", "http://127.0.0.1:9")
chapter = chapter.replace("</head>", f"<style>html,body{{background-image:url('{origin}/__publication-background')}}</style></head>")
chapter = chapter.replace("<body>", '<body onload="parent.document.body.dataset.publicationCanary=\'executed\'">')
chapter = chapter.replace("</body>", '<a href="chapter-2.xhtml#cfi">Safe internal chapter fragment</a>'
    '<a href="javascript:parent.document.body.dataset.publicationCanary=\'executed\'">Executable destination</a>'
    '<iframe src="../bootstrap.html"></iframe><object data="../bootstrap.html"></object>'
    '<input aria-label="Editable publication control" value="Type here"/></body>')
members["EPUB/chapter-1.xhtml"] = chapter.encode()
with zipfile.ZipFile(folder / "g1c-foliate.epub", "w", compression=zipfile.ZIP_DEFLATED) as target:
    for name, data in members.items():
        target.writestr(name, data)
mixed = dict(members)
mixed["EPUB/book.opf"] = members["EPUB/book.opf"].replace(
    b'id="c0" href="chapter-1.xhtml" media-type="application/xhtml+xml"',
    b'id="c0" href="chapter-1.xhtml" media-type="Text/Html; charset=utf-8"')
assert mixed["EPUB/book.opf"] != members["EPUB/book.opf"]
with zipfile.ZipFile(folder / "mixed-mime.epub", "w", compression=zipfile.ZIP_DEFLATED) as target:
    for name, data in mixed.items():
        target.writestr(name, data)
bad_spine = dict(members)
bad_spine["EPUB/book.opf"] = members["EPUB/book.opf"].replace(
    b'id="c0" href="chapter-1.xhtml" media-type="application/xhtml+xml"',
    b'id="c0" href="chapter-1.xhtml" media-type="font/ttf"')
with zipfile.ZipFile(folder / "bad-spine-mime.epub", "w", compression=zipfile.ZIP_DEFLATED) as target:
    for name, data in bad_spine.items():
        target.writestr(name, data)
with zipfile.ZipFile(folder / "acquisition-a.epub") as source:
    long_book = {name: source.read(name) for name in source.namelist()}
long_chapter = long_book["EPUB/chapter-1.xhtml"].decode()
long_chapter = long_chapter.replace("<body>", '<body style="font-size:20px!important;font-family:serif!important">')
long_chapter = long_chapter.replace("</body>", '<p id="rem-prose" style="font-size:1rem">Relative root-sized prose.</p></body>')
long_chapter = long_chapter.replace("</body>", "".join(
    f"<p>Long reading passage {i}. Reliable pagination keeps this section open while advancing through its visible text.</p>"
    for i in range(160)) + "</body>")
long_book["EPUB/chapter-1.xhtml"] = long_chapter.encode()
with zipfile.ZipFile(folder / "long-reading.epub", "w", compression=zipfile.ZIP_DEFLATED) as target:
    for name, data in long_book.items():
        target.writestr(name, data)
print(folder / "g1c-foliate.epub")
prefix_members = dict(members)
prefix_chapter = prefix_members["EPUB/chapter-1.xhtml"].decode()
body_start = prefix_chapter.index(">", prefix_chapter.index("<body")) + 1
prefix_chapter = (prefix_chapter[:body_start] +
    '<script>parent.document.body.dataset.publicationCanary="executed"</script>'
    '<iframe src="../bootstrap.html"></iframe>' + prefix_chapter[body_start:])
prefix_members["EPUB/chapter-1.xhtml"] = prefix_chapter.encode()
with zipfile.ZipFile(folder / "active-prefix.epub", "w", compression=zipfile.ZIP_DEFLATED) as target:
    for name, data in prefix_members.items():
        target.writestr(name, data)
