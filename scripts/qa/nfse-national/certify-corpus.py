"""Offline complementary certification. Never patches official XSDs or imports notes."""
import hashlib
import json
import re
from importlib.metadata import version
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import url2pathname

from jsonschema import Draft202012Validator, FormatChecker
from lxml import etree

REPO = Path(__file__).resolve().parents[3]
ROOT = REPO / 'tests/fixtures/nfse/nacional'
SCHEMAS = ROOT / 'schemas'
OUTPUT = REPO / 'docs/analises/nfse-e1-e2-certificacao-2026-10-09.evidence.json'


class LocalSchemasOnly(etree.Resolver):
    def resolve(self, url, public_id, context):
        target = Path(url2pathname(urlparse(url).path) if url.startswith('file:') else url).resolve()
        if not target.is_relative_to(SCHEMAS.resolve()):
            raise ValueError('Schema outside the offline corpus')
        return self.resolve_filename(str(target), context)


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = etree.XMLParser(resolve_entities=False, load_dtd=False, no_network=True)
    parser.resolvers.add(LocalSchemasOnly())
    manifest = read_json(ROOT / 'manifest.json')
    sources = [read_json(SCHEMAS / 'provenance.json'),
               read_json(SCHEMAS / 'homolog-20260727/provenance.json')]
    for source in sources:
        for entry in source['arquivos']:
            if digest(SCHEMAS / entry['arquivo']) != entry['sha256']:
                raise ValueError('Official schema hash changed')
    rows = []
    for case in manifest['casos']:
        xml = ROOT / case['arquivo']
        if digest(xml) != case['sha256']:
            raise ValueError('Original structural fixture hash changed')
        profiles = [('producao-20260209', SCHEMAS / case['versao'])]
        if case['versao'] == '1.01':
            profiles.append(('homolog-20260727', SCHEMAS / 'homolog-20260727/1.01'))
        for profile, directory in profiles:
            schema_path = directory / f"{case['raiz_xsd']}_v{case['versao']}.xsd"
            schema = etree.XMLSchema(etree.parse(str(schema_path.resolve()), parser))
            document = etree.fromstring(xml.read_bytes(),
                etree.XMLParser(resolve_entities=False, load_dtd=False, no_network=True))
            valid = schema.validate(document)
            errors = []
            for error in schema.error_log:
                match = re.search(r"Element '\{[^}]+\}([^']+)'", error.message)
                errors.append({'linha': error.line, 'tipo': error.type_name,
                               'campo': match.group(1) if match else None})
            expected = case['xsd_erros_esperados'] if profile == 'producao-20260209' else (
                [{'campo': 'vLiq', 'tipo': 'SCHEMAV_CVC_PATTERN_VALID'}]
                if case['id'] == 'campo-invalido' else [])
            matches = sorted((e['tipo'], e['campo']) for e in errors) == sorted(
                (e['tipo'], e['campo']) for e in expected)
            rows.append({'id': case['id'], 'versao': case['versao'], 'origem': case['origem'],
                         'perfil': profile, 'xsd_sha256': digest(schema_path),
                         'xml_sha256': digest(xml), 'xsd_valido': valid,
                         'erros': errors, 'expectativa_negativa': bool(expected),
                         'coincide_com_expectativa': matches and valid == (not expected)})
    exported = read_json(REPO / 'docs/analises/nfse-canonical-1.1.0.schema.json')
    Draft202012Validator.check_schema(exported)
    validator = Draft202012Validator(exported, format_checker=FormatChecker())
    output = read_json(REPO / 'docs/analises/nfse-e1-e2-certificacao-2026-10-09.outputs.json')
    canonical_rows = []
    for row in output['resultados']:
        errors = list(validator.iter_errors(row['documento']))
        canonical_rows.append({'id': row['id'], 'valido': not errors,
                               'erros': [list(e.absolute_path) for e in errors]})
    # Fail-closed probes validate the independent validator, not just positive examples.
    import copy
    original = output['resultados'][0]['documento']
    negative_rows = []
    mutations = [
        ('ausente_com_zero', lambda d: d['vencimento'].update(valor='0.00')),
        ('presente_sem_fonte', lambda d: d['totais']['valor_servicos'].update(evidencias=[])),
        ('elegibilidade_inventada', lambda d: d['verificacao'].update(elegibilidade='APTA')),
        ('campo_extra', lambda d: d.update(aprovado=True)),
        ('decimal_ambiguo', lambda d: d['totais']['valor_servicos'].update(valor='1,00')),
        ('derivado_sem_formula', lambda d: d['totais']['liquido_derivado'].update(derivacao=None)),
    ]
    for label, mutate in mutations:
        candidate = copy.deepcopy(original)
        mutate(candidate)
        negative_rows.append({'id': label, 'rejeitado': not validator.is_valid(candidate)})
    series_rows = []
    for directory in [SCHEMAS / '1.01', SCHEMAS / 'homolog-20260727/1.01']:
        simple_types = etree.parse(str(directory / 'tiposSimples_v1.01.xsd'), parser)
        ns = {'xs': 'http://www.w3.org/2001/XMLSchema'}
        restriction = simple_types.xpath('//xs:simpleType[@name="TSSerieDPS"]/xs:restriction', namespaces=ns)[0]
        # Build a separate experiment from the two published facets, never change an official file.
        schema_xml = etree.Element('{http://www.w3.org/2001/XMLSchema}schema', nsmap={'xs': ns['xs']})
        element = etree.SubElement(schema_xml, '{'+ns['xs']+'}element', name='serie')
        simple = etree.SubElement(element, '{'+ns['xs']+'}simpleType')
        isolated = etree.SubElement(simple, '{'+ns['xs']+'}restriction', base='xs:string')
        for facet in restriction:
            if etree.QName(facet).localname in ['maxLength', 'pattern']:
                etree.SubElement(isolated, facet.tag, **dict(facet.attrib))
        probe = etree.XMLSchema(schema_xml)
        for serie in ['00001', '1', '^1$']:
            series_rows.append({'schema': directory.relative_to(SCHEMAS).as_posix(),
                                'serie': serie, 'valido': probe.validate(etree.fromstring(
                                    ('<serie>'+serie+'</serie>').encode()))})
    report = {'node': output['node'], 'modo': 'SOMENTE_LEITURA',
              'corpus': 'SINTETICO_ESTRUTURAL', 'assinatura_verificada': False,
              'autorizacao_fiscal_verificada': False, 'documentos_emitidos_testados': 0,
              'schemas_oficiais_alterados': False, 'fontes': sources,
              'xsd': rows, 'canonical': canonical_rows, 'canonical_negativos': negative_rows,
              'probe_serie_libxml2': series_rows, 'probe_escopo': 'TIPO_ISOLADO_NAO_DOCUMENTO_COMPLETO',
              'schema_canonico_sha256': digest(REPO / 'docs/analises/nfse-canonical-1.1.0.schema.json'),
              'validadores': {'libxml2': etree.LIBXML_VERSION, 'lxml': etree.LXML_VERSION,
                             'jsonschema': version('jsonschema'), 'dialeto': 'draft-2020-12'}}
    OUTPUT.write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
    passed = all(r['coincide_com_expectativa'] for r in rows) and all(
        r['valido'] for r in canonical_rows) and all(r['rejeitado'] for r in negative_rows)
    print(json.dumps({'xsd_checks': len(rows), 'xsd_pass': sum(r['xsd_valido'] for r in rows),
                      'canonical_pass': sum(r['valido'] for r in canonical_rows),
                      'negative_pass': sum(r['rejeitado'] for r in negative_rows), 'passed': passed}))
    raise SystemExit(0 if passed else 1)


if __name__ == '__main__':
    main()
