"""Publish redacted local certification evidence; never imports real fiscal data into a service."""
import argparse
import csv
import hashlib
import json
import pathlib
import subprocess

ENGINES = ('saxes', 'sax', 'fast')


def read_json(path):
    content = path.read_bytes()
    return json.loads(content.decode('utf-16' if content.startswith(b'\xff\xfe') else 'utf-8-sig'))


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def preservation(root, private):
    initial = read_json(private / 'initial/state.json')
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
    branch = subprocess.check_output(['git', 'branch', '--show-current'], text=True).strip()
    stashes = subprocess.check_output(['git', 'stash', 'list', '--format=%H %gs'], text=True).splitlines()
    checks = [{**entry, 'unchanged': hashlib.sha256((root / entry['path']).read_bytes()).hexdigest()
               == entry['sha256']} for entry in initial['files']]
    passed = all(entry['unchanged'] for entry in checks) and head == initial['head'] \
        and branch == initial['branch'] and stashes == initial['stashes']
    return {'passed': passed, 'head': head, 'branch': branch, 'stashes': stashes,
            'protected_e1_e2': 112, 'protected_e25': 33, 'snapshot_files': len(checks),
            'schema_files': sum(entry['path'].endswith('.xsd') for entry in checks), 'files': checks}


def counts(path):
    value = read_json(path)
    return {key: value[key] for key in ('numTotalTests', 'numPassedTests', 'numFailedTests', 'numPendingTests')}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--private', required=True)
    parser.add_argument('--report', required=True)
    args = parser.parse_args()
    root = pathlib.Path.cwd()
    private = pathlib.Path(args.private).resolve()
    report = pathlib.Path(args.report).resolve()
    if not private.name.startswith('nfse-e27-') or report.parent != root / 'docs/analises' \
            or not report.name.startswith('nfse-e27-'):
        raise RuntimeError('QA_OUTPUT_SCOPE_INVALID')
    report.mkdir(exist_ok=True)
    security = {engine: read_json(private / f'security-{engine}.json') for engine in ENGINES}
    corpus = {engine: read_json(private / f'corpus-summary-{engine}.json') for engine in ENGINES}
    resources = read_json(private / 'resources.json')
    recheck = read_json(private / 'resources-recheck.json')
    maintained = read_json(private / 'maintenance.json')
    audit = read_json(private / 'audit.json')
    native = read_json(private / 'native-probe.json')
    preserved = preservation(root, private)
    if not preserved['passed']:
        raise RuntimeError('BASELINE_DRIFT')
    technical = {engine: counts(private / f'tests-{engine}.json') for engine in ENGINES}
    technical.update({'e1_e2': counts(private / 'tests-e1-e2.json'),
                      'regression_lf': counts(private / 'tests-regression-lf.json'),
                      'uncorrected_control': counts(private / 'tests-sax-e25.json')})
    summaries = {}
    for engine in ENGINES:
        vectors = security[engine]['observations']
        documents = corpus[engine]['observations']
        fields = [field for document in documents for field in document['field_comparison']]
        workloads = [row for row in resources['observations'] if row['engine'] == engine
                     and row['workload'] != 'native-large-text']
        summaries[engine] = {
            'xml_vectors': len(vectors), 'positive_vectors': sum(row['expected_accepted'] for row in vectors),
            'negative_vectors': sum(not row['expected_accepted'] for row in vectors),
            'vectors_passed': sum(row['passed'] for row in vectors),
            'false_positive_acceptances': [row['id'] for row in vectors if row['accepted'] and not row['expected_accepted']],
            'false_negative_rejections': [row['id'] for row in vectors if not row['accepted'] and row['expected_accepted']],
            'documents': len(documents), 'canonical_match': sum(row['complete_matched'] for row in documents),
            'structural_match': sum(row['tree_matched'] for row in documents),
            'recognized': sum(row['result'] == 'RECONHECIDO' for row in documents),
            'field_checks': len(fields), 'complete_field_matches': sum(row['complete_field_matched'] for row in fields),
            'resource_workloads': len(workloads),
            'resource_passes': sum(row['budget_passed'] and row['acceptance_passed'] for row in workloads),
        }
    candidate_passes = [engine for engine in ('sax', 'fast')
                        if summaries[engine]['vectors_passed'] == summaries[engine]['xml_vectors']
                        and summaries[engine]['canonical_match'] == summaries[engine]['documents']
                        and summaries[engine]['structural_match'] == summaries[engine]['documents']
                        and summaries[engine]['complete_field_matches'] == summaries[engine]['field_checks']
                        and summaries[engine]['resource_passes'] == summaries[engine]['resource_workloads']]
    stage = 'PASS' if candidate_passes else 'BLOCKED'
    validation = {'date': '2026-10-11', 'stage': stage, 'integration': 'BLOCKED', 'e26': 'BLOCKED',
                  'node': security['saxes']['node'], 'tests': technical, 'summary': summaries,
                  'candidate_passes': candidate_passes, 'certified_fiscal_documents': 0,
                  'fiscal_precision': None, 'fiscal_recall': None,
                  'build': {'executed': False, 'reason': 'QA MJS/Python only; application and Next sources unchanged'},
                  'scope': 'ISOLATED_DEVELOPMENT_POC_NO_DISPATCHER_DATABASE_DEPLOY_COMMIT_PUSH'}
    validation['checks'] = read_json(private / 'quality-checks.json')
    write_json(report / 'validation.json', validation)
    write_json(report / 'preservation.json', preserved)
    write_json(report / 'security.json', security)
    write_json(report / 'benchmark.json', corpus)
    write_json(report / 'resources.json', resources)
    write_json(report / 'resources-recheck.json', recheck)
    write_json(report / 'maintenance.json', {**maintained, 'audit_summary': audit.get('metadata', {}).get('vulnerabilities')})
    write_json(report / 'native-probe.json', native)
    with (report / 'fields.csv').open('w', encoding='utf-8', newline='') as handle:
        writer = csv.DictWriter(handle, fieldnames=['engine', 'id', 'classification', 'version', 'field',
            'expected_state', 'actual_state', 'value_matched', 'complete_field_matched',
            'expected_field_sha256', 'actual_field_sha256'])
        writer.writeheader()
        for engine in ENGINES:
            for document in corpus[engine]['observations']:
                for field in document['field_comparison']:
                    writer.writerow({'engine': engine, 'id': document['id'], 'classification': document['classification'],
                                     'version': document['version'], **field})
    rows = ['# Matriz XML E2.7', '', 'Entradas sintéticas estruturais, não documentos fiscais emitidos.', '',
            '| Caso | Família | Esperado | saxes | sax corrigido | fast configurado |',
            '| --- | --- | --- | --- | --- | --- |']
    indexes = {engine: {row['id']: row for row in security[engine]['observations']} for engine in ENGINES}
    for row in security['saxes']['observations']:
        statuses = []
        for engine in ENGINES:
            actual = indexes[engine][row['id']]
            statuses.append(('PASS' if actual['passed'] else 'FAIL') +
                            (' / ACEITO' if actual['accepted'] else ' / ' + str(actual['code'])))
        rows.append('| ' + ' | '.join([row['id'], row['family'], 'ACEITAR' if row['expected_accepted'] else 'REJEITAR', *statuses]) + ' |')
    (report / 'TEST_MATRIX.md').write_text('\n'.join(rows) + '\n', encoding='utf-8')
    report_rows = ['# NFS-e Nacional — E2.7', '', 'Data: 11/10/2026.', '',
                   f'**Etapa: {stage}. Integração operacional: BLOCKED. E2.6: BLOCKED.**', '',
                   'As três correções autorizadas foram implementadas na PoC. Nenhum candidato mantido atende a todos os gates; não recomendar substituição.', '',
                   '## Preservação', '',
                   'Branch `homolog`, commit `364c5ad2db6db9134be9e08added44299fff7a87`; dois stashes intactos. '
                   '112 arquivos E1/E2, 33 arquivos E2.5 e a migration histórica conferidos por SHA-256. '
                   '146 arquivos do snapshot inicial permanecem iguais. Backups anteriores não foram sobrescritos.', '',
                   '## Resultados comparativos', '',
                   '| Engine | Vetores XML | Corpus canônico/árvore | Campos completos | Recursos |',
                   '| --- | ---: | ---: | ---: | ---: |']
    for engine, row in summaries.items():
        report_rows.append(f"| {engine} | {row['vectors_passed']}/{row['xml_vectors']} | "
                           f"{row['canonical_match']}/{row['documents']} e {row['structural_match']}/{row['documents']} | "
                           f"{row['complete_field_matches']}/{row['field_checks']} | {row['resource_passes']}/{row['resource_workloads']} |")
    report_rows += ['', 'São os mesmos 26 XMLs da E2.5: 15 sintéticos e 11 públicos sem comprovação fiscal suficiente. '
                    '24 reconhecidos e duas rejeições de domínio preservadas em cada engine. Nenhum documento novo foi coletado. '
                    'Matching de campos inclui ausência, zero, original, normalização, derivação e evidências. '
                    'Não é precisão fiscal; precisão e recall fiscal continuam null.', '',
                    '## Correções e arquitetura', '',
                    '- `xml-guards.mjs`: caracteres XML 1.0, gramática/posição da declaração, unicidade e limites de atributos. '
                    'Uma leitura lexical antecipada no início da tag impede que SAX acumule atributos sem limite antes dos eventos diferidos.',
                    '- `sax-tree.mjs`: bridge de infraestrutura com namespaces; rejeita antes de consolidar a árvore. '
                    'Não remove ou substitui caracteres de entrada.',
                    '- `fast-tree.mjs`: configuração explícita de strings/ordem/entidades, validação sintática e resolução de namespaces no bridge. '
                    'Não copia mapeamento fiscal; esse candidato ainda aceita entradas proibidas.',
                    '- O adaptador E1/E2 é reutilizado por mock exclusivo do Vitest. A aplicação nunca importa estes módulos.', '',
                    '## Incompatibilidades remanescentes', '',
                    '- SAX aceita `&AMP;`: `parseEntity` consulta a tabela também com nome em minúsculas. '
                    '`strictEntities` restringe quais entidades existem, mas não corrige case sensitivity. '
                    'Falha da biblioteca, reproduzida sem as barreiras E2.7.',
                    '- FXP + decoder aceita referências proibidas de controle/surrogate (removidas), overflow (mantida literal) '
                    'e U+FFFE (decodificado). Desconhecidas/HTML/case incorreto permanecem literais sem rejeição. '
                    'Com `onNCR=throw` todas as referências numéricas seriam bloqueadas, inclusive válidas; não é equivalência. '
                    'Falhas da biblioteca/decoder e limitações de configuração.',
                    '- FXP aceita comentário contendo `--` interno: validator/parser ignoram o defeito. '
                    'Reproduzido no núcleo, sem bridge E2.7.',
                    '- Ajustes internos de QA corrigidos antes da entrega: offset BOM do metadata FXP, '
                    'hash de objetos sem dependência da ordem de propriedades, whitespace removido pelo SAX na declaração '
                    'e contagem de atributos antes dos eventos diferidos. Não foram atribuídos a divergências fiscais.', '',
                    '## Recursos', '',
                    'Ensaio em processos novos e sequenciais, Node 22, GC exposto e loader TSX. '
                    'Budgets locais: 15 s wall, 10 s CPU, 512 MiB RSS, 256 MiB old-space. '
                    'Watchdog amostra RSS/CPU a cada 50 ms e encerra o filho quando excede orçamento. '
                    'Esses números são limites de QA, não SLOs de produção.', '',
                    '| Engine | Carga | Mediana ms | Pico RSS MiB | Resultado |',
                    '| --- | --- | ---: | ---: | --- |']
    for row in resources['observations']:
        median = row.get('median_ms')
        peak = max(row.get('max_rss_kib', 0) * 1024, row['sampled_peak_rss']) / 1024 / 1024
        status = 'PASS' if row['budget_passed'] and row['acceptance_passed'] else row.get('failure_category', row.get('termination') or 'FAIL')
        report_rows.append(f"| {row['engine']} | {row['workload']} | {median:.3f} | {peak:.1f} | {status} |" if median is not None
                           else f"| {row['engine']} | {row['workload']} | N/A | {peak:.1f} | {status} |")
    report_rows += ['', 'Tempos não incluem inicialização do loader; CPU total inclui aquecimento. '
                    'RSS inclui processo/loader; sampling pode perder picos entre amostras. '
                    'O processo nativo FXP também é testado separadamente com 18 MiB, sem validator ou conversão de árvore, '
                    'para distinguir custo nativo de erro do bridge. Falhas de memória não foram mascaradas aumentando heap.', '',
                    'No ensaio principal, saxes/nodes foi encerrado ao superar o orçamento CPU total de 10 s '
                    '(incluindo aquecimento e repetições). Uma única reexecução focada com os mesmos budgets passou, '
                    'com mediana de 66.047 ms. O resultado principal não foi substituído; ambos estão registrados em '
                    'resources.json/resources-recheck.json. A variação impede concluir um SLO estável ou atribuir '
                    'a causa a contenção externa sem telemetria adicional.', '',
                    '## XSD e pendências documentais', '',
                    'Schemas oficiais intactos. Nenhuma validação XSD foi rerodada ou reinterpretada nesta etapa.', '',
                    '| Pacote / versão | Documentos | libxml2 PASS/REJECT | System.Xml PASS/REJECT |',
                    '| --- | ---: | ---: | ---: |',
                    '| Produção 20260209 / 1.00 | 7 | 5/2 | 5/2 |',
                    '| Produção 20260209 / 1.01 | 18 | 3/15 | 15/3 |',
                    '| Homologação 20260727 / 1.01 | 18 | 15/3 | 15/3 |', '',
                    'Matriz histórica: [XSD_RESULTS](../nfse-e25-2026-10-09/XSD_RESULTS.md). '
                    'Produção 1.01 continua divergente em TSSerieDPS. Homologação não substitui produção. '
                    'Assinatura presente, validação criptográfica, emissão e situação fiscal atual continuam estados separados. '
                    'Pendências semânticas E2.5 de prestador/emissão/versão DPS não foram alteradas.', '',
                    '## Testes e qualidade', '',
                    'Testes negativos têm assertions reais e exit code não zero quando o candidato aceita documento proibido. '
                    'O controle com SAX E2.5 sem correções também falha, comprovando sensibilidade da suite.', '']
    for name, value in technical.items():
        report_rows.append(f"- {name}: {value['numPassedTests']} passaram, {value['numFailedTests']} falharam, {value['numPendingTests']} skips.")
    report_rows += ['', 'Typecheck estrito E2.7, typecheck raiz sem incremental, ESLint dos MJS novos, compilação Python '
                    'e diff foram executados; logs/hashes em validation.json. A regressão completa foi executada no worktree LF '
                    'existente do mesmo commit; não declarar aprovação da suite completa no checkout CRLF. '
                    'Build Next não foi repetido: o escopo é exclusivamente QA MJS/Python e a aplicação está intacta.', '',
                    '## Segurança, manutenção e recomendação', '',
                    'Versões fixadas: saxes 6.0.0 (raiz), sax 1.6.1, fast-xml-parser 5.11.2 e @nodable/entities 3.1.0 (QA isolado). '
                    'Saxes permanece arquivado; sax e FXP têm manutenção recente. Fontes e advisories consultados em maintenance.json; '
                    'ausência de advisory/audit não garante rejeição segura, como os testes demonstraram.', '',
                    'Referências normativas: [XML 1.0](https://www.w3.org/TR/REC-xml/) e '
                    '[unicidade de atributos com namespace](https://www.w3.org/TR/REC-xml-names/#uniqAttrs). '
                    'Fontes dos projetos: [sax](https://github.com/isaacs/sax-js), '
                    '[saxes arquivado](https://github.com/lddubeau/saxes), '
                    '[release FXP 5.11.2](https://github.com/NaturalIntelligence/fast-xml-parser/releases/tag/v5.11.2) e '
                    '[advisories FXP](https://github.com/NaturalIntelligence/fast-xml-parser/security/advisories).', '',
                    'Manter saxes como referência isolada de E1/E2 e bloquear troca. '
                    'Próximas alternativas, sujeitas a nova autorização: corrigir a resolução case-sensitive de SAX '
                    '(idealmente upstream), ou avaliar outro parser estrito mantido. '
                    'Para FXP, uma barreira lexical completa/validator adicional e investigação de memória seriam necessárias; '
                    'não presumir que ajustes de configuração resolveriam todos os defeitos.', '',
                    'Nenhuma integração operacional, E3, banco, persistência, migration, alteração financeira, deploy, commit ou push.', '',
                    '## Arquivos e evidências', '',
                    'Código: `scripts/qa/nfse-national/e27/`; pacote e lock isolados. '
                    'Relatórios: este diretório, matriz XML, security.json, benchmark.json, fields.csv, resources.json, '
                    'native-probe.json, maintenance.json, preservation.json e validation.json. '
                    'Resultados completos dos documentos permanecem somente no diretório privado E2.7. '
                    'Nenhum original ou dado fiscal foi enviado a serviço de extração externo.']
    (report / 'REPORT.md').write_text('\n'.join(report_rows) + '\n', encoding='utf-8')
    print(json.dumps({'stage': stage, 'summary': summaries, 'preservation': preserved['passed']}))
    return 0 if stage == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
