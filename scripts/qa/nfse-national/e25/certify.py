"""E2.5 offline evidence. No operational adapter imports, network, or database calls.

Reference values are read independently with namespace-aware XPath and Python
Decimal/date/check-digit validation. Third-party fixtures never become issued
documents because their shape, tpAmb, or XSD happens to match.
"""
import argparse
import csv
import hashlib
import json
import re
from collections import Counter
from datetime import date, datetime
from decimal import Decimal
from importlib.metadata import version
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import url2pathname

from jsonschema import Draft202012Validator, FormatChecker
from lxml import etree

REPO = Path(__file__).resolve().parents[4]
CORPUS = REPO / 'tests/fixtures/nfse/nacional'
SCHEMAS = CORPUS / 'schemas'
NS = {'n': 'http://www.sped.fazenda.gov.br/nfse'}
OUTPUT = REPO / 'docs/analises/nfse-e25-2026-10-09'


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')


def value_at(value, path):
    for part in path.split('.'):
        if isinstance(value, list):
            value = value[int(part)] if int(part) < len(value) else None
        elif isinstance(value, dict):
            value = value.get(part)
        else:
            return None
    return value


class LocalOnly(etree.Resolver):
    def resolve(self, url, public_id, context):
        target = Path(url2pathname(urlparse(url).path) if url.startswith('file:') else url).resolve()
        if not target.is_relative_to(SCHEMAS.resolve()):
            raise ValueError('NONLOCAL_SCHEMA')
        return self.resolve_filename(str(target), context)


def safe_xml(path):
    data = Path(path).read_bytes()
    if b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper():
        raise ValueError('REFERENCE_DTD_FORBIDDEN')
    return etree.fromstring(data, etree.XMLParser(resolve_entities=False, load_dtd=False, no_network=True))


def validate_xsd(cases):
    parser = etree.XMLParser(resolve_entities=False, load_dtd=False, no_network=True)
    parser.resolvers.add(LocalOnly())
    results = []
    for case in cases:
        if sha(case['path']) != case['sha256']:
            raise ValueError('CORPUS_HASH_CHANGED')
        if case['version'] not in ('1.00', '1.01'):
            results.append({'id': case['id'], 'version': case['version'], 'classification': case['classification'],
                            'profile': None, 'valid': None, 'status': 'NOT_EXECUTED_MISSING_SUPPORTED_VERSION',
                            'xml_sha256': case['sha256'], 'errors': []})
            continue
        profiles = [('producao-20260209', SCHEMAS / case['version'])]
        if case['version'] == '1.01':
            profiles.append(('homolog-20260727', SCHEMAS / 'homolog-20260727/1.01'))
        for profile, directory in profiles:
            schema_path = directory / f"{case['root_xsd']}_v{case['version']}.xsd"
            schema = etree.XMLSchema(etree.parse(str(schema_path.resolve()), parser))
            valid = schema.validate(safe_xml(case['path']))
            errors = []
            for error in schema.error_log:
                match = re.search(r"Element '\{[^}]+\}([^']+)'", error.message)
                cause = ('MISSING_REQUIRED_CHILD' if 'Missing child element' in error.message
                         else 'ORDER_OR_UNEXPECTED_ELEMENT' if 'not expected' in error.message
                         else 'LEXICAL_PATTERN_MISMATCH' if 'pattern' in error.message
                         else 'DOCUMENT_NOT_CONFORMANT_TO_OFFICIAL_SCHEMA')
                errors.append({'line': error.line, 'type': error.type_name,
                               'field': match.group(1) if match else None,
                               'cause': 'PRODUCTION_SERIES_PATTERN' if match and match.group(1) == 'serie'
                               else cause})
            results.append({'id': case['id'], 'version': case['version'],
                            'classification': case['classification'], 'profile': profile,
                            'valid': valid, 'xml_sha256': case['sha256'],
                            'schema_sha256': sha(schema_path), 'errors': errors})
    return results


def valid_tax_id(text, kind):
    length = 14 if kind == 'cnpj' else 11
    if not re.fullmatch(r'\d{'+str(length)+'}', text) or len(set(text)) == 1:
        return False
    digits = [int(char) for char in text]
    if kind == 'cnpj':
        weights = ([5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
        expected = digits[:12]
        for weight in weights:
            remainder = sum(a*b for a, b in zip(expected, weight)) % 11
            expected.append(0 if remainder < 2 else 11-remainder)
    else:
        expected = digits[:9]
        for size in (9, 10):
            remainder = sum(a*b for a, b in zip(expected, range(size+1, 1, -1))) * 10 % 11
            expected.append(0 if remainder == 10 else remainder)
    return expected == digits


def convert(raw, kind):
    text = raw.strip()
    if kind in ('cnpj', 'cpf'):
        if not valid_tax_id(text, kind):
            raise ValueError('CHECK_DIGIT')
    elif kind == 'money':
        if not re.fullmatch(r'(0|[1-9]\d{0,14})(\.\d{2})?', text):
            raise ValueError('NON_CANONICAL_DECIMAL')
        return format(Decimal(text), '.2f')
    elif kind == 'date':
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', text):
            raise ValueError('DATE')
        date.fromisoformat(text)
    elif kind == 'timestamp':
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})', text):
            raise ValueError('OFFSET_DATETIME')
        datetime.fromisoformat(text.replace('Z', '+00:00'))
    elif kind in ('rate_iss', 'rate_federal'):
        digits = '' if kind == 'rate_iss' else '\\d?'
        if not re.fullmatch(r'(0|[1-9]'+digits+r')(\.\d{2})?', text):
            raise ValueError('RATE_FORMAT')
    elif kind.startswith('pattern:'):
        if not re.fullmatch(kind[len('pattern:'):], text):
            raise ValueError('LEXICAL_RULE')
    elif kind == 'nfse_key':
        if not re.fullmatch(r'NFS\d{50}', text):
            raise ValueError('NATIONAL_KEY_LENGTH')
        return text[3:]
    elif kind == 'iss_flag':
        return {'1': False, '2': True, '3': True}[text]
    elif kind == 'pis_flag':
        return {'0': False, '1': True, '2': False, '3': True, '4': True,
                '5': True, '6': False, '7': False, '8': False, '9': True}[text]
    elif kind == 'cofins_flag':
        return {'0': False, '1': True, '2': False, '3': True, '4': True,
                '5': False, '6': True, '7': True, '8': False, '9': False}[text]
    if not text:
        raise ValueError('EMPTY')
    return text


def field_reference(root, xpath, kind):
    nodes = root.xpath(xpath, namespaces=NS) if xpath else []
    if not nodes:
        return {'estado': 'AUSENTE', 'valor': None, 'xpath': xpath, 'original': None}
    if len(nodes) != 1:
        raise ValueError('AMBIGUOUS_REFERENCE')
    raw = nodes[0] if isinstance(nodes[0], str) else nodes[0].text or ''
    try:
        value = convert(raw, kind)
        state = 'PRESENTE'
    except (ValueError, KeyError):
        value, state = None, 'INVALIDO'
    return {'estado': state, 'valor': value, 'xpath': xpath, 'original': raw}


def independent_reference(path):
    root = safe_xml(path)
    nfse = etree.QName(root).localname == 'NFSe'
    n = '/n:NFSe/n:infNFSe' if nfse else ''
    d = n+'/n:DPS/n:infDPS' if nfse else '/n:DPS/n:infDPS'
    # Independent documentary reference: NT 008, table 2.4.5, pp.16-17.
    # emit identifies the emitter; it must not silently replace DPS/prest.
    p = d+'/n:prest'
    t = d+'/n:toma'
    v = d+'/n:valores'
    rules = {
        'identificacao.numero_nfse': (n+'/n:nNFSe' if nfse else '', 'pattern:[1-9]\\d{0,12}'),
        'identificacao.chave_acesso': (n+'/@Id' if nfse else '', 'nfse_key'),
        'identificacao.processamento': (n+'/n:dhProc' if nfse else '', 'timestamp'),
        'identificacao.codigo_status_geracao': (n+'/n:cStat' if nfse else '',
            'pattern:(100|101|102|103)' if root.get('versao') == '1.00' else 'pattern:(100|102|103|107)'),
        # NT 008 renders dhProc as the documentary NFSe issuance timestamp.
        # This is not proof of issuance or active fiscal status.
        'identificacao.emissao': (n+'/n:dhProc' if nfse else '', 'timestamp'),
        'identificacao.competencia': (d+'/n:dCompet', 'date'),
        'identificacao.ambiente': (d+'/n:tpAmb', 'pattern:[12]'),
        'identificacao.municipio_emissor': (d+'/n:cLocEmi', 'pattern:\\d{7}'),
        'identificacao.dps.id': (d+'/@Id', 'pattern:DPS\\d{42}'),
        'identificacao.dps.numero': (d+'/n:nDPS', 'pattern:[1-9]\\d{0,14}'),
        'identificacao.dps.serie': (d+'/n:serie', 'pattern:\\d{1,5}'),
        'identificacao.dps.emissao': (d+'/n:dhEmi', 'timestamp'),
        'servicos.0.descricao': (d+'/n:serv/n:cServ/n:xDescServ', 'text'),
        'servicos.0.codigo_tributacao_nacional': (d+'/n:serv/n:cServ/n:cTribNac', 'pattern:\\d{6}'),
        'totais.valor_bruto_documental': ('', 'money'),
        'totais.valor_servicos': (v+'/n:vServPrest/n:vServ', 'money'),
        'totais.valor_recebido': (v+'/n:vServPrest/n:vReceb', 'money'),
        'totais.deducoes': (v+'/n:vDedRed/n:vDR', 'money'),
        'totais.desconto_condicionado': (v+'/n:vDescCondIncond/n:vDescCond', 'money'),
        'totais.desconto_incondicionado': (v+'/n:vDescCondIncond/n:vDescIncond', 'money'),
        'totais.base_calculo_iss': (n+'/n:valores/n:vBC' if nfse else '', 'money'),
        'totais.valor_iss': (n+'/n:valores/n:vISSQN' if nfse else '', 'money'),
        'totais.aliquota_iss': (n+'/n:valores/n:pAliqAplic' if nfse else '', 'rate_iss'),
        'totais.total_retencoes': (n+'/n:valores/n:vTotalRet' if nfse else '', 'money'),
        'totais.liquido_documental': (n+'/n:valores/n:vLiq' if nfse else '', 'money'),
        'totais.valor_pis': (v+'/n:trib/n:tribFed/n:piscofins/n:vPis', 'money'),
        'totais.valor_cofins': (v+'/n:trib/n:tribFed/n:piscofins/n:vCofins', 'money'),
        'totais.aliquota_pis': (v+'/n:trib/n:tribFed/n:piscofins/n:pAliqPis', 'rate_federal'),
        'totais.aliquota_cofins': (v+'/n:trib/n:tribFed/n:piscofins/n:pAliqCofins', 'rate_federal'),
        'totais.base_pis_cofins': (v+'/n:trib/n:tribFed/n:piscofins/n:vBCPisCofins', 'money'),
        'totais.retencao_previdenciaria': (v+'/n:trib/n:tribFed/n:vRetCP', 'money'),
        'totais.retencao_irrf': (v+'/n:trib/n:tribFed/n:vRetIRRF', 'money'),
        'totais.retencao_csll': (v+'/n:trib/n:tribFed/n:vRetCSLL', 'money'),
        'totais.iss_retido': (v+'/n:trib/n:tribMun/n:tpRetISSQN', 'iss_flag'),
        'totais.pis_retido': (v+'/n:trib/n:tribFed/n:piscofins/n:tpRetPisCofins', 'pis_flag'),
        'totais.cofins_retido': (v+'/n:trib/n:tribFed/n:piscofins/n:tpRetPisCofins', 'cofins_flag'),
        'totais.valor_ibs': (n+'/n:IBSCBS/n:totCIBS/n:gIBS/n:vIBSTot' if nfse else '', 'money'),
        'totais.valor_cbs': (n+'/n:IBSCBS/n:totCIBS/n:gCBS/n:vCBS' if nfse else '', 'money'),
        'totais.total_nf_com_ibscbs': (n+'/n:IBSCBS/n:totCIBS/n:vTotNF' if nfse else '', 'money'),
        'vencimento': ('', 'date'),
    }
    for name, base in [('prestador', p), ('tomador', t)]:
        for key, tag, kind in [('cnpj', 'CNPJ', 'cnpj'), ('cpf', 'CPF', 'cpf'),
                               ('razao_social', 'xNome', 'text'), ('email', 'email', 'text')]:
            rules[name+'.'+key] = (base+'/n:'+tag, kind)
    result = {key: field_reference(root, xpath, kind) for key, (xpath, kind) in rules.items()}
    operands = [result['totais.'+f] for f in ('valor_servicos', 'desconto_condicionado', 'desconto_incondicionado', 'total_retencoes')]
    result['totais.liquido_derivado'] = {'estado': 'AUSENTE', 'valor': None, 'xpath': None, 'original': None}
    if nfse and all(f['estado'] == 'PRESENTE' for f in operands):
        net = Decimal(operands[0]['valor'])-sum(Decimal(f['valor']) for f in operands[1:])
        if net >= 0:
            result['totais.liquido_derivado'] = {'estado': 'DERIVADO', 'valor': format(net, '.2f'),
                'xpath': None, 'original': None, 'formula': 'vServ-vDescCond-vDescIncond-vTotalRet; requires all explicit operands'}
    return result


def redacted(value, field, public):
    if not public or not value or not (field.startswith(('prestador.', 'tomador.', 'servicos.'))
                                      or field.endswith(('chave_acesso', 'dps.id'))):
        return value
    return {'redacted': True, 'value_sha256': hashlib.sha256(str(value).encode()).hexdigest()}


def compare_fields(sample, expected, actual, engine, public=False):
    rows = []
    for field, wanted in expected.items():
        received = value_at(actual, field)
        state = received.get('estado') if isinstance(received, dict) else None
        value = received.get('valor') if isinstance(received, dict) else None
        matches = state == wanted['estado'] and value == wanted['valor']
        rows.append({'id': sample['id'], 'version': sample['version'],
                     'classification': sample['classification'], 'engine': engine, 'field': field,
                     'expected_state': wanted['estado'], 'actual_state': state,
                     'expected_value': redacted(wanted['valor'], field, public),
                     'actual_value': redacted(value, field, public), 'matched': matches,
                     'severity': None if matches else 'MEDIA' if field == 'identificacao.emissao' else 'ALTA' if field.startswith(('totais.', 'prestador.', 'tomador.', 'identificacao.')) else 'MEDIA',
                     'cause': None if matches else 'SUPPORTED_LAYOUT_DOCUMENT_REJECTED' if not actual
                       else 'EMIT_VS_DPS_PREST_NT008' if field.startswith('prestador.')
                       else 'DH_PROC_NOT_PROJECTED_AS_DOCUMENTARY_ISSUANCE' if field == 'identificacao.emissao'
                       else 'STATE_DIVERGENCE' if state != wanted['estado'] else 'VALUE_DIVERGENCE',
                     'source_xpath': wanted.get('xpath'),
                     'trace_preserved': isinstance(received, dict) and (wanted['estado'] == 'AUSENTE'
                       and received.get('evidencias') == [] or wanted['estado'] != 'AUSENTE'
                       and bool(received.get('evidencias')) and all(e['documento_sha256'] == sample['sha256']
                           for e in received.get('evidencias', [])))})
    return rows


def field_metrics(rows):
    # Exact-value precision/recall: a wrong emitted value counts as FP and FN.
    # Absence and invalid-input preservation are scored separately, never as TN padding.
    target = {'PRESENTE', 'DERIVADO'}
    tp = sum(r['matched'] and r['expected_state'] in target for r in rows)
    fp = sum(r['actual_state'] in target and not r['matched'] for r in rows)
    fn = sum(r['expected_state'] in target and not r['matched'] for r in rows)
    return {'checks': len(rows), 'matched': sum(r['matched'] for r in rows),
            'tp': tp, 'fp': fp, 'fn': fn,
            'exact_value_precision': tp/(tp+fp) if tp+fp else None,
            'exact_value_recall': tp/(tp+fn) if tp+fn else None,
            'expected_states': dict(Counter(r['expected_state'] for r in rows)),
            'traces_preserved': sum(r['trace_preserved'] for r in rows)}


def main(private):
    OUTPUT.mkdir(exist_ok=True)
    baseline = read(private / 'initial/state.json')
    for file in baseline['files']:
        if sha(REPO / file['path']) != file['sha256']:
            raise ValueError('E1_E2_BASELINE_CHANGED: '+file['path'])
    sources = [read(SCHEMAS / 'provenance.json'), read(SCHEMAS / 'homolog-20260727/provenance.json')]
    for source in sources:
        for file in source['arquivos']:
            if sha(SCHEMAS / file['arquivo']) != file['sha256']:
                raise ValueError('OFFICIAL_SCHEMA_CHANGED')
    manifest = read(CORPUS / 'manifest.json')['casos']
    public = read(private / 'public-samples.json')
    cases = [{'id': r['id'], 'path': str(CORPUS / r['arquivo']), 'sha256': r['sha256'],
              'version': r['versao'], 'classification': r['origem'], 'root_xsd': r['raiz_xsd']} for r in manifest]
    cases += [{'id': r['id'], 'path': r['local_private_path'], 'sha256': r['sha256'],
               'version': r['version'], 'classification': r['classification'], 'root_xsd': r['root']} for r in public]
    xsd = validate_xsd(cases)
    engines = {name: read(private / ('adapter-'+name+'.json')) for name in ['saxes', 'sax']}
    field_rows, canonical_rows, reference_rows, rejection_rows = [], [], [], []
    schema = read(REPO / 'docs/analises/nfse-canonical-1.1.0.schema.json')
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    Draft202012Validator.check_schema(schema)
    for sample in cases:
        is_public = sample['classification'] != 'SINTETICO_ESTRUTURAL'
        expected = independent_reference(sample['path']) if is_public else read(CORPUS / next(
            m['esperado'] for m in manifest if m['id'] == sample['id']))['campos']
        reference_rows.append({'id': sample['id'], 'version': sample['version'],
                               'classification': sample['classification'], 'sha256': sample['sha256'],
                               'fields': {f: {**e, 'valor': redacted(e['valor'], f, is_public),
                                  'original': redacted(e.get('original'), f, is_public)} for f, e in expected.items()}})
        for name, data in engines.items():
            found = next(row for row in data['structural']+data['public_samples'] if row['id'] == sample['id'])
            actual = found['result'].get('documento', {})
            if found['result']['resultado'] != 'RECONHECIDO':
                rejection_rows.append({'id': sample['id'], 'engine': name,
                                       'version': sample['version'], 'result': found['result']})
                # A supported-version, XSD-positive fixture rejected by the adapter
                # must count as missing values, rather than silently leaving recall.
                if sample['version'] in ('1.00', '1.01'):
                    field_rows += compare_fields(sample, expected, {}, name, is_public)
                continue
            errors = list(validator.iter_errors(actual))
            canonical_rows.append({'id': sample['id'], 'engine': name, 'valid': not errors,
                                   'errors': [list(e.absolute_path) for e in errors]})
            field_rows += compare_fields(sample, expected, actual, name, is_public)
    inventory = []
    for sample in cases:
        source = next((r for r in public if r['id'] == sample['id']), None)
        xml = safe_xml(sample['path'])
        municipality = xml.xpath('string(//n:infDPS/n:cLocEmi)', namespaces=NS) or None
        inventory.append({'id': sample['id'], 'source_url': source['url'] if source else None,
                          'local_source': None if source else 'tests/fixtures/nfse/nacional/'+Path(sample['path']).name,
                          'classification': sample['classification'], 'version': sample['version'],
                          'namespace': etree.QName(xml).namespace, 'root': etree.QName(xml).localname,
                          'municipality_ibge': municipality, 'sha256': sample['sha256'],
                          'provenance': {'tree_sha': source['tree_sha'], 'git_blob_sha': source['file_sha_git']} if source else {'synthetic_manifest': True},
                          'declared_environment': xml.xpath('string(//n:infDPS/n:tpAmb)', namespaces=NS) or None,
                          'signature_elements': len(xml.xpath('//*[local-name()="Signature"]')),
                          'issued_or_official_homologation_proven': False, 'xml_pdf_pair': False,
                          'xsd': [r for r in xsd if r['id'] == sample['id']]})
    comparisons = []
    for sample in cases:
        outputs = [next(r['result'] for r in data['structural']+data['public_samples'] if r['id'] == sample['id']) for data in engines.values()]
        comparisons.append({'id': sample['id'], 'complete_output_equal': outputs[0] == outputs[1]})
    summary = {}
    for name in engines:
        summary[name] = {classification: field_metrics([r for r in field_rows if r['engine'] == name and r['classification'] == classification])
                         for classification in sorted({r['classification'] for r in cases})}
    security = {name: {'cases': len(data['security']), 'passed': sum(r['passed'] for r in data['security']),
                       'negative_cases': sum(not r['expected_accepted'] for r in data['security']),
                       'false_positive_acceptances': sum(not r['expected_accepted'] and r['result']['resultado'] == 'RECONHECIDO' for r in data['security']),
                       'results': [{k: v for k, v in r.items() if k != 'result'} | {'result': r['result']['resultado'], 'code': r['result'].get('codigo')} for r in data['security']]}
                for name, data in engines.items()}
    benchmark = {'mode': 'OFFLINE_NO_INTEGRATION', 'node': engines['saxes']['node'],
                 'fiscal_precision': None, 'fiscal_recall': None, 'issued_documents': 0,
                 'official_homologation_documents': 0, 'xml_pdf_pairs': 0,
                 'structural_only_metrics': summary, 'security': security,
                 'canonical_schema_checks': canonical_rows, 'cross_parser_outputs': comparisons,
                 'document_rejections': rejection_rows,
                 'divergences': [r for r in field_rows if not r['matched']],
                 'reference_method': 'Independent Python XPath/Decimal/date/check-digit rules and NT 008 table 2.4.5 (dhProc and DPS/prest); existing handwritten synthetic expectations preserved',
                 'metric_definition': 'TP exact state+value for PRESENTE/DERIVADO; wrong value FP+FN; AUSENTE/INVALIDO separate checks. Not fiscal accuracy.'}
    write(OUTPUT / 'inventory.json', {'baseline_head': baseline['head'], 'documents': inventory, 'official_schema_packages': sources})
    write(OUTPUT / 'xsd-libxml2.json', {'engine': {'lxml': etree.LXML_VERSION, 'libxml2': etree.LIBXML_VERSION}, 'results': xsd})
    write(OUTPUT / 'xsd-dotnet.json', read(private / 'xsd-dotnet.json'))
    write(OUTPUT / 'reference-expectations.json', {'fiscal_certification': False, 'references': reference_rows})
    write(OUTPUT / 'benchmark.json', benchmark)
    write(OUTPUT / 'performance.json', read(private / 'performance.json'))
    with (OUTPUT / 'field-checks.csv').open('w', encoding='utf-8-sig', newline='') as handle:
        writer = csv.DictWriter(handle, fieldnames=list(field_rows[0]))
        writer.writeheader()
        writer.writerows(field_rows)
    write(OUTPUT / 'preservation.json', {'baseline_head': baseline['head'], 'baseline_branch': baseline['branch'],
                                       'stashes': baseline['stashes'], 'preserved_files': len(baseline['files']),
                                       'all_baseline_hashes_unchanged': True, 'schema_files_unchanged': sum(len(s['arquivos']) for s in sources),
                                       'jsonschema_version': version('jsonschema')})
    print(json.dumps({'documents': len(cases), 'xsd_checks': sum(r['valid'] is not None for r in xsd), 'xsd_pass': sum(r['valid'] is True for r in xsd),
                      'field_checks': len(field_rows), 'divergences': len(benchmark['divergences']),
                      'canonical_valid': sum(r['valid'] for r in canonical_rows),
                      'complete_output_equal': sum(r['complete_output_equal'] for r in comparisons), 'structural_metrics': summary}))


if __name__ == '__main__':
    args = argparse.ArgumentParser()
    args.add_argument('--private-directory', type=Path, required=True)
    main(args.parse_args().private_directory.resolve())
