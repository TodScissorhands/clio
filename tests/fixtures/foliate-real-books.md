# Real Foliate compatibility publications

CI downloads the unmodified GITenberg release EPUBs in `foliate-real-books.manifest`; it does not generate or vendor publication content. SHA-256 is mandatory before a download becomes a fixture, and existing files must also match. Release URLs are versioned, not `latest`; GitHub release assets are not inherently immutable, so replacement fails closed on the pinned digest. Availability still depends on GitHub. No Project Gutenberg dynamically regenerated EPUB endpoint is used.

| Local name | Source release / asset ID | Source commit | Bytes / spine items |
| --- | --- | --- | --- |
| `gutenberg-11.epub` | [Alice 0.2.2](https://github.com/GITenberg/Alice-s-Adventures-in-Wonderland_11/releases/tag/0.2.2), asset 3368843 | `9a607feca48a204b997e754cad53f5ec6172a492` | 87,818 / 15 |
| `gutenberg-1342.epub` | [Pride 0.0.2](https://github.com/GITenberg/Pride-and-Prejudice_1342/releases/tag/0.0.2), asset 1212716 | `09dc2d4863013fb2d4f5e67821553400ed31a435` | 5,364,126 / 65 |

Downloads inspected on 2026-11-18 contain valid EPUB containers and OPFs identifying Lewis Carroll's *Alice’s Adventures in Wonderland* and Jane Austen's *Pride and Prejudice*. Their source metadata identifies Project Gutenberg books [11](https://www.gutenberg.org/ebooks/11) and [1342](https://www.gutenberg.org/ebooks/1342). Spine index 5 in each is chapter 3 with genuine prose (Alice: “They were indeed a queer-looking party”; Pride: “Mr. Bennet was among the earliest”). These historical multi-section editions preserve the existing compatibility test's chapter/passage oracle; GITenberg 0.2.3 single-spine editions do not. They differ from the previously accepted local Gutenberg-generated snapshots; runtime compatibility must be exercised against this pinned corpus, not inferred from the old snapshots.

All OPF manifest resource paths in the selected archives were checked against actual ZIP entries. Alice 0.0.1, 0.1.0, 0.2.0 and 0.2.1 were rejected because they reference a missing `OEBPS/cover.jpg`; 0.2.2 has no missing manifest resources and passes ZIP CRC inspection. Do not repair or synthesize archive resources to make an invalid release pass.

Rights: Alice source metadata declares public domain in the USA. Pride's text is public domain in the USA, but this Recovering the Classics edition includes a Tim Daniel (2015) cover and declares [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/). Preserve that attribution and noncommercial restriction; these downloads are test inputs, not application distribution assets. Check local rights before reuse outside CI.

Provision and run (Linux, required WebKitGTK prerequisites installed):

```sh
export CLIO_FOLIATE_REAL_BOOKS="$(mktemp -d)"
bash scripts/provision-foliate-real-books.sh "$CLIO_FOLIATE_REAL_BOOKS"
PATH="/usr/bin:$PATH" xvfb-run -a bash scripts/test-webkit-required.sh
```

CI sets the variable to a runner-temporary directory. Developers can still point `CLIO_FOLIATE_REAL_BOOKS` directly at their own real fixtures and run tests without provisioning; neither the runtime wrapper nor tests replace or checksum-restrict explicitly supplied corpora. To update CI publications, independently inspect downloaded EPUB contents, review provenance/rights, change the manifest hashes explicitly, and run the real CFI compatibility tests. Never update a checksum merely to silence a mismatch.
