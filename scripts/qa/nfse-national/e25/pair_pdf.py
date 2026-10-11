"""Compare pinned third-party XML/PDF fixture pairs locally, without fiscal claims."""
import argparse
import json
import re
import unicodedata
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from certify import OUTPUT, independent_reference, read, sha, write


def normalized(text):
    return unicodedata.normalize('NFKD', text).encode('ascii', errors='ignore').decode().strip().lower()


def label_value(text, label):
    lines = text.splitlines()
    positions = [i for i, line in enumerate(lines) if normalized(line) == label]
    if len(positions) != 1 or positions[0]+1 >= len(lines):
        return None
    return lines[positions[0]+1].strip()


def main(private):
    pdf_rows = read(private / 'pdf-texts.json')
    pdf_sources = read(private / 'pdf-samples.json')
    xml_sources = read(private / 'public-samples.json')
    pairings = [('nfse_test_prod.xml', 'danfse_default_prod.pdf'),
                ('nfse_rtc_valid.xml', 'danfse_rtc_valid.pdf')]
    pairs = []
    for xml_name, pdf_name in pairings:
        xml = next(r for r in xml_sources if r['id'].endswith(xml_name))
        pdf = next(r for r in pdf_sources if r['id'].endswith(pdf_name))
        extracted = next(r for r in pdf_rows if r['id'] == pdf['id'])
        if sha(xml['local_private_path']) != xml['sha256'] or sha(pdf['local_private_path']) != pdf['sha256']:
            raise ValueError('PAIR_HASH_CHANGED')
        facts = independent_reference(xml['local_private_path'])
        mappings = [
            ('identificacao.chave_acesso', 'chave de acesso da nfs-e', 'text'),
            ('identificacao.numero_nfse', 'numero da nfs-e', 'text'),
            ('identificacao.competencia', 'competencia da nfs-e', 'date'),
            ('identificacao.emissao', 'data e hora da emissao da nfs-e', 'timestamp'),
            ('totais.valor_servicos', 'valor da operacao / servico', 'money'),
            ('totais.total_retencoes', 'total das retencoes (issqn / federais)', 'money'),
            ('totais.liquido_documental', 'valor liquido da nfs-e', 'money'),
        ]
        checks = []
        for field, label, kind in mappings:
            displayed = label_value(extracted['text'], label)
            expected = facts[field]['valor']
            # PDFs display local civil time without offset; compare presentation,
            # never infer a timezone that the PDF does not supply.
            if kind == 'timestamp' and expected:
                expected = datetime.fromisoformat(expected.replace('Z', '+00:00')).strftime('%d/%m/%Y %H:%M:%S')
            elif kind == 'date' and expected:
                expected = datetime.fromisoformat(expected).strftime('%d/%m/%Y')
            if kind == 'money' and displayed:
                match = re.fullmatch(r'R\$\s*([\d.,]+)', displayed)
                displayed = format(Decimal(match[1].replace('.', '').replace(',', '.')), '.2f') if match else None
            checks.append({'field': field, 'pdf_label': label, 'xml_state': facts[field]['estado'],
                           'matched': displayed == expected and expected is not None,
                           'xml_xpath': facts[field]['xpath'], 'pdf_value_located': displayed is not None})
        pairs.append({'xml_id': xml['id'], 'pdf_id': pdf['id'], 'xml_sha256': xml['sha256'],
                      'pdf_sha256': pdf['sha256'], 'xml_url': xml['url'], 'pdf_url': pdf['url'],
                      'classification': 'THIRD_PARTY_GENERATED_FIXTURE_PAIR',
                      'issued_or_official_homologation_proven': False, 'pdf_pages': extracted['pages'],
                      'pair_identity_confirmed': checks[0]['matched'], 'checks': checks})
    write(OUTPUT / 'xml-pdf-pairs.json', {'fiscal_certification': False, 'comparison': 'LOCAL_TEXT_LABELS_NOT_OCR_OR_MODEL', 'pairs': pairs})
    inventory = read(OUTPUT / 'inventory.json')
    for row in inventory['documents']:
        match = next((p for p in pairs if p['xml_id'] == row['id']), None)
        if match:
            row['xml_pdf_pair'] = match['pair_identity_confirmed']
            row['paired_pdf_sha256'] = match['pdf_sha256']
    inventory['pdf_documents'] = [{k: v for k, v in p.items() if k != 'local_private_path'} for p in pdf_sources]
    write(OUTPUT / 'inventory.json', inventory)
    benchmark = read(OUTPUT / 'benchmark.json')
    benchmark['xml_pdf_pairs'] = sum(p['pair_identity_confirmed'] for p in pairs)
    benchmark['certified_fiscal_xml_pdf_pairs'] = 0
    write(OUTPUT / 'benchmark.json', benchmark)
    print(json.dumps({'pairs': len(pairs), 'identity_confirmed': sum(p['pair_identity_confirmed'] for p in pairs),
                      'field_checks': sum(len(p['checks']) for p in pairs),
                      'matched': sum(c['matched'] for p in pairs for c in p['checks'])}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--private-directory', type=Path, required=True)
    main(parser.parse_args().private_directory.resolve())
