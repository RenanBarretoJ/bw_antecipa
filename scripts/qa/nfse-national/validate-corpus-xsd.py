"""Offline structural validation with pinned official schemas. Not signature verification."""
import hashlib
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import url2pathname
from lxml import etree

ROOT = Path(__file__).resolve().parents[3] / 'tests/fixtures/nfse/nacional'


class LocalSchemasOnly(etree.Resolver):
    def resolve(self, url, public_id, context):
        target = Path(url2pathname(urlparse(url).path) if url.startswith('file:') else url).resolve()
        if not target.is_relative_to((ROOT / 'schemas').resolve()):
            raise ValueError('Schema outside the offline corpus')
        return self.resolve_filename(str(target), context)


parser = etree.XMLParser(resolve_entities=False, load_dtd=False, no_network=True)
parser.resolvers.add(LocalSchemasOnly())
manifest = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))
provenance = json.loads((ROOT / 'schemas/provenance.json').read_text(encoding='utf-8'))
for entry in provenance['arquivos']:
    assert hashlib.sha256((ROOT / 'schemas' / entry['arquivo']).read_bytes()).hexdigest() == entry['sha256'], 'Schema changed'
rows = []
for case in manifest['casos']:
    xml = ROOT / case['arquivo']
    assert hashlib.sha256(xml.read_bytes()).hexdigest() == case['sha256'], 'Fixture changed'
    path = ROOT / 'schemas' / case['versao'] / f"{case['raiz_xsd']}_v{case['versao']}.xsd"
    schema = etree.XMLSchema(etree.parse(str(path.resolve()), parser))
    document = etree.fromstring(xml.read_bytes(), etree.XMLParser(resolve_entities=False, load_dtd=False, no_network=True))
    valid = schema.validate(document)
    errors = []
    for error in schema.error_log:
        match = re.search(r"Element '\{[^}]+\}([^']+)'", error.message)
        errors.append({'linha': error.line, 'tipo': error.type_name, 'campo': match.group(1) if match else None})
    exact_errors = sorted((e['tipo'], e['campo']) for e in errors) == sorted((e['tipo'], e['campo']) for e in case['xsd_erros_esperados'])
    rows.append({'id': case['id'], 'xsd_valido': valid, 'esperado': case['xsd_esperado'],
                 'coincide': valid == case['xsd_esperado'] and exact_errors,
                 'limitacao_xsd': case['limitacao_xsd'], 'erros': errors})
report = {'assinaturas_verificadas': False, 'schemas_oficiais_alterados': False, 'resultados': rows}
if '--write-report' in sys.argv:
    output = Path(__file__).resolve().parents[3] / 'docs/analises/nfse-e1-e2-2026-10-09.xsd.json'
    output.write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
print(json.dumps(report, indent=2))
sys.exit(0 if all(row['coincide'] for row in rows) else 1)
