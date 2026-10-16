from pathlib import Path
import json
import sys
import hashlib
import pypdfium2 as pdfium

if len(sys.argv) != 2:
    raise SystemExit('Usage: validate-pdfs.py <private-evidence-directory>')
root = Path(sys.argv[1]).resolve()
results = []
for file in sorted((root / 'pdfs').glob('*.pdf')):
    if not file.name.startswith(('fixed-configured-', 'baseline-configured-')):
        continue
    document = pdfium.PdfDocument(str(file))
    markers = []
    for index in range(len(document)):
        page = document[index]
        text = page.get_textpage()
        markers.append('QA PDF PAGE ' + str(index + 1) in text.get_text_range())
        text.close()
        page.close()
    passed = len(document) == 3 and all(markers)
    results.append({'file': file.name, 'status': 'PASS' if passed else 'FAIL', 'pages': len(document), 'markers': markers, 'sha256': hashlib.sha256(file.read_bytes()).hexdigest()})
    if file.name in ['fixed-configured-v24.21.0-cold-first.pdf', 'fixed-configured-v22.23.2-parallel-3.pdf']:
        for index in (0, 2):
            page = document[index]
            bitmap = page.render(scale=1.2)
            bitmap.to_pil().save(root / (file.stem + '-page-' + str(index + 1) + '.png'))
            bitmap.close()
            page.close()
    document.close()
report = {'validator': 'PDFium via pypdfium2', 'results': results, 'passed': sum(x['status'] == 'PASS' for x in results), 'failed': sum(x['status'] != 'PASS' for x in results)}
(root / 'pdfium-validation.json').write_text(json.dumps(report, indent=2), encoding='utf8')
print(json.dumps({'files': len(results), 'passed': report['passed'], 'failed': report['failed']}))
assert report['failed'] == 0
