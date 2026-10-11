"""Publish sanitized, evidence-derived E2.8 certification. Never export fiscal values."""
import argparse
import collections
import csv
import hashlib
import json
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[4]

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--private', required=True)
    args = parser.parse_args()
    private = pathlib.Path(args.private).resolve()
    assert private.name.startswith('nfse-e28-')
    report = ROOT / 'docs/analises/nfse-e28-2026-10-11'
    report.mkdir(exist_ok=True)
    def read(name):
        return json.loads((private / name).read_text(encoding='utf-8'))
    def write(name, value):
        (report / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    initial = read('initial/state.json')
    protected = [dict(path=name, sha256=expected, unchanged=digest(ROOT / name) == expected)
                 for name, expected in initial['files'].items()]
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    branch = subprocess.check_output(['git', 'branch', '--show-current'], cwd=ROOT, text=True).strip()
    stashes = subprocess.check_output(['git', 'stash', 'list', '--format=%H %s'], cwd=ROOT, text=True).strip().splitlines()
    preservation_pass = all(r['unchanged'] for r in protected) and head == initial['head'] \
        and branch == initial['branch'] and stashes == initial['stashes']
    preservation = dict(passed=preservation_pass, head=head, branch=branch, stashes=stashes,
                        protected_files=len(protected), files=protected)
    write('preservation.json', preservation)
    security = {engine: read('security-' + engine + '.json') for engine in ['saxes', 'sax', 'sax-e27']}
    corpus = {engine: read('corpus-summary-' + engine + '.json') for engine in ['saxes', 'sax']}
    resources = read('resources.json')
    quality = read('quality.json')
    summary = {}
    for engine in ['saxes', 'sax']:
        observations = security[engine]['observations']
        documents = corpus[engine]['observations']
        workloads = [r for r in resources['observations'] if r['engine'] == engine]
        fields = [f for d in documents for f in d['field_comparison']]
        summary[engine] = dict(security_total=len(observations), security_passed=sum(r['passed'] for r in observations),
            positive=sum(r['expected_accepted'] for r in observations),
            negative=sum(not r['expected_accepted'] for r in observations),
            false_accepts=sum(not r['expected_accepted'] and r['accepted'] for r in observations),
            false_rejects=sum(r['expected_accepted'] and not r['accepted'] for r in observations),
            unexpected_errors=sum(r['code'] == 'UNEXPECTED_POC_ERROR' for r in observations),
            corpus_total=len(documents), corpus_matched=sum(d['complete_matched'] for d in documents),
            tree_matched=sum(d['tree_matched'] for d in documents), fields=len(fields),
            fields_matched=sum(f['complete_field_matched'] and f['value_matched'] for f in fields),
            resource_total=len(workloads), resource_passed=sum(r['budget_passed'] and r['acceptance_passed']
                and r.get('code') != 'UNEXPECTED_POC_ERROR' for r in workloads),
            max_sampled_cpu_seconds=max(r['sampled_cpu_seconds'] for r in workloads),
            max_sampled_rss_mib=max(r['sampled_peak_rss'] for r in workloads) / 1024 ** 2)
    original = security['sax-e27']['observations']
    fault = dict(tests=len(original), failures=sum(not r['passed'] for r in original),
                 false_accepts=sum(not r['expected_accepted'] and r['accepted'] for r in original))
    fault_pass = len(original) == summary['sax']['security_total'] and fault['false_accepts'] > 0 \
        and fault['failures'] == fault['false_accepts'] and all(r['code'] != 'UNEXPECTED_POC_ERROR' for r in original) \
        and any(r['id'] == 'e28-case-AMP-text' and r['accepted'] for r in original)
    gates = dict(preservation=preservation_pass, fault_reproduced=fault_pass,
                 quality=all(r['passed'] for r in quality))
    for engine, row in summary.items():
        gates[engine + '_security'] = row['security_total'] == row['security_passed'] and row['unexpected_errors'] == 0
        gates[engine + '_corpus'] = row['corpus_total'] == row['corpus_matched'] == row['tree_matched'] == 26
        gates[engine + '_fields'] = row['fields'] == row['fields_matched'] == 3276
        gates[engine + '_resources'] = row['resource_total'] == row['resource_passed'] == 14
    result = 'PASS' if all(gates.values()) else 'BLOCKED'
    certification = dict(stage='E2.8', classification=result, node=resources['node'], gates=gates,
        summary=summary, fault_control=fault, previous_cases=84,
        new_cases=summary['sax']['security_total'] - 84,
        certified_fiscal_documents=0, fiscal_precision=None, fiscal_recall=None,
        e26='BLOCKED: absence of proven fiscal issuance', operational_integration='BLOCKED: new authorization required')
    write('certification.json', certification)
    write('security.json', security)
    write('benchmark.json', corpus)
    write('resources.json', resources)
    write('quality.json', quality)
    write('reproduction.json', read('reproduction.json'))
    with (report / 'fields.csv').open('w', newline='', encoding='utf-8') as stream:
        writer = csv.DictWriter(stream, fieldnames=['engine', 'document', 'field', 'expected_state', 'actual_state',
              'value_matched', 'complete_field_matched', 'expected_field_sha256', 'actual_field_sha256'])
        writer.writeheader()
        for engine, data in corpus.items():
            for document in data['observations']:
                for field in document['field_comparison']:
                    writer.writerow(dict(engine=engine, document=document['id'], **field))
    versions = collections.Counter(d['version'] or 'absent' for d in corpus['saxes']['observations'])
    inventory = [dict(id=d['id'], classification=d['classification'], version=d['version'],
                      source_sha256=d['source_sha256']) for d in corpus['saxes']['observations']]
    write('inventory.json', dict(versions=dict(versions), documents=inventory,
        provenance_source='../nfse-e25-2026-10-09/inventory.json', new_documents_obtained=False,
        certified_fiscal_documents=0))
    cpu = summary['sax']['max_sampled_cpu_seconds']
    rss = summary['sax']['max_sampled_rss_mib']
    reference_bytes = next(r['input_bytes'] for r in resources['observations'] if r['workload'] == 'references')
    metrics = '\n'.join('| {engine} | {workload} | {median_ms:.3f} | {sampled_cpu_seconds:.3f} | {rss:.2f} |'.format(
        **r, rss=r['sampled_peak_rss'] / 1024 ** 2) for r in resources['observations'])
    text = f'''# E2.8 — correção de referências XML e certificação da PoC

Data: 11/10/2026. Resultado: **{result} da PoC**, sem liberação operacional.

## Preservação e escopo

`homolog`, HEAD `{head}`; dois stashes e {len(protected)} arquivos protegidos inalterados,
incluindo E1/E2, E2.5, E2.7 e os schemas oficiais. O checkout já continha trabalho local;
esse trabalho foi preservado. Novo snapshot privado: `{private.as_posix()}/initial`.
Mudanças limitadas a `scripts/qa/nfse-national/e28/` e este diretório de evidências.
Sem alterações no parser da aplicação, dispatcher, persistência, elegibilidade, banco,
migrations, schemas, backups ou stashes. Sem E3, commit, push ou deploy.

## Causa raiz comprovada

Em `sax@1.6.1`, `parseEntity`, linhas 1111–1136 de `lib/sax.js`, calcula
`entityLC = entity.toLowerCase()` e consulta `parser.ENTITIES[entityLC]` após a consulta
exata. `strictEntities: true` restringe a tabela às entidades XML, mas não desabilita
essa tentativa sem diferenciação de caixa. A mesma conversão também aceita `&#X41;`.
A falha vem da biblioteca; a configuração estrita já era usada pela PoC E2.7.
`reproduction.json` registra versão, hash do código instalado e execução nativa,
E2.7, E2.8 e `saxes`, sem depender apenas de interpretação do código.

Normas de referência: [XML 1.0, referências](https://www.w3.org/TR/REC-xml/#sec-references)
e [caracteres permitidos](https://www.w3.org/TR/REC-xml/#NT-Char).
Referências nomeadas são sensíveis à caixa; a produção hexadecimal usa `x` minúsculo.
Código da biblioteca: [sax-js](https://github.com/isaacs/sax-js), com a versão instalada
fixada e identificada por hash nesta evidência.

## Correção isolada

`references.mjs` percorre a fonte original por contexto lexical. Reconhece exclusivamente
`amp`, `lt`, `gt`, `apos`, `quot`; verifica dígitos ASCII e limites Unicode das referências
numéricas, sem `parseInt` permissivo. Textos e atributos entre aspas são validados;
comentários, CDATA e instruções de processamento preservam suas sequências literais.
Um `<` literal dentro de atributo é rejeitado, pois não inicia um contexto ignorável.
Também valida essa proibição sem depender de uma referência inválida presente no atributo.
`&amp;AMP;` permanece válido: não há segunda expansão nem inspeção de texto já decodificado.

Não há normalização, substituição de conteúdo, alteração de dependências, alteração do
vendor ou I/O externo no validador. Nomes são examinados com tamanho limitado e valores
numéricos acumulados em uma passada; referências muito longas não geram substring
proporcional ao tamanho. O wrapper mantém as proteções E2.7, incluindo DTD/ENTITY,
caracteres proibidos, namespaces, declarações, atributos duplicados e limites estruturais.
A política de entrada é executada antes da validação lexical e novamente no bridge E2.7;
esse custo deliberado está incluído nas medições. A rejeição conservadora de strings
DOCTYPE/ENTITY da política anterior foi preservada.

## Testes e equivalência

| Critério | saxes | sax E2.8 |
|---|---:|---:|
| Casos XML anteriores | 84/84 | 84/84 |
| Casos novos | {certification['new_cases']}/{certification['new_cases']} | {certification['new_cases']}/{certification['new_cases']} |
| Total de casos XML | {summary['saxes']['security_passed']}/{summary['saxes']['security_total']} | {summary['sax']['security_passed']}/{summary['sax']['security_total']} |
| Aceitações indevidas | 0 | 0 |
| Rejeições indevidas | 0 | 0 |
| XMLs com árvore e resultado canônico equivalentes | 26/26 | 26/26 |
| Campos completos equivalentes, incluindo valores, estado e procedência | 3.276/3.276 | 3.276/3.276 |
| Ensaios de recursos | 14/14 | 14/14 |

Cada engine tem 536 testes Vitest: 510 de segurança/conformidade e 26 de comparação.
Os negativos precisam rejeitar efetivamente, e erro genérico não conta como certificação.
O controle congelado E2.7 produziu {fault['failures']} falhas, todas aceitações indevidas,
em 510 vetores; seu exit code não zero é a evidência esperada de reprodução da falha.
Casos novos incluem todas as combinações de caixa das cinco entidades, texto/aspas
simples/duplas, referências numéricas válidas e inválidas, desconhecidas, sem terminador,
sem dígitos, sinais, overflow, caracteres proibidos, contextos literais, DTD/XXE e truncamento.

Corpus inalterado: versões {dict(versions)}. São 15 sintéticos e 11 exemplos públicos
sem comprovação de emissão. As duas rejeições documentais anteriores continuam iguais.
A equivalência foi testada contra o baseline congelado e árvores novas de `saxes`;
não é precisão fiscal medida. Precisão/recall fiscais permanecem **não mensuráveis**.
Resultados canônicos completos permanecem no diretório privado, pois podem conter dados
dos documentos públicos. `fields.csv` registra os 6.552 confrontos dos dois engines com
estado, resultado e hashes, sem exportar os valores fiscais.

A [matriz XSD anterior](../nfse-e25-2026-10-09/XSD_RESULTS.md) continua válida para
o corpus congelado: produção 1.00 5/2 nos dois validadores; produção 1.01 3/15 no
libxml2 e 15/3 no System.Xml; homologação 1.01 15/3 em ambos (aprovados/rejeitados).
Não foram repetidos os validadores XSD, nem alterados seus pacotes ou resultados.
O pacote de homologação não substituiu silenciosamente o de produção.

## CPU e memória — {resources['node']}

Limites anteriores mantidos: CPU de processo 10 s, wall 15 s, RSS 512 MiB, old-space
Node 256 MiB; tamanho 20 MiB, profundidade 64, 50.000 nós, 64 atributos por elemento.
Execução sequencial em subprocessos novos, sem testes/lint concorrentes. O watchdog
inclui startup/tsx e warmup; amostragem a cada 50 ms. Medianas medem parsing de árvore,
sem mapear campos fiscais. `maxRSS` e CPU reportados pelo Node também estão no JSON.

SAX E2.8: maior CPU amostrada **{cpu:.3f} s**, maior RSS amostrado **{rss:.2f} MiB**.
Nenhuma falha de budget, timeout, OOM ou erro inesperado em qualquer engine.
Os 11 workloads anteriores foram mantidos e adicionados três: 60.000 referências em
{reference_bytes:,} bytes, referência numérica com um milhão de zeros e referência desconhecida
com 18 MiB. Os recursos são evidência local limitada; não constituem SLO de produção.
Não foi feita extrapolação de ganho de desempenho global. O SAX é mais lento em
alguns casos, incluindo nós e referência com muitos zeros, embora dentro dos limites.

| Engine | Workload | Mediana ms | CPU de processo amostrada s | RSS amostrado MiB |
|---|---|---:|---:|---:|
{metrics}

## Qualidade e regressão

- E1/E2: 73 testes aprovados no Node 22.
- Regressão completa: 3.172 aprovados, 10 skips, zero falhas, no checkout LF preservado.
- TypeScript da PoC (`checkJs`) e do projeto, ESLint com zero warnings, compilação Python
  e `git diff --check`: aprovados; veja `quality.json`.
- A regressão completa usou o checkout LF existente para não alterar a migration histórica
  com CRLF. Esta execução não corrige nem oculta essa diferença no checkout principal.
- Build Next não repetido nesta etapa: mudanças exclusivas em QA e relatórios, nenhum
  arquivo de aplicação ou configuração de build modificado. Não reivindicamos novo build.
- Nenhum container criado.

## Riscos e decisão

| Critério | Estado | Evidência ou condição |
|---|---|---|
| Referências XML e regressões cobertas | APROVADO | 510/510 por engine |
| Extração e rastreabilidade no corpus existente | APROVADO | 26 XMLs, zero divergência |
| Budgets locais de recursos | APROVADO | 28/28 ensaios |
| Preservação de resultados e baseline | APROVADO | 174 hashes e dois stashes |
| Conformidade universal XML/W3C | PENDENTE | suíte finita, sem prova formal ou suíte W3C completa |
| Certificação fiscal E2.6 | BLOQUEADO | nenhum documento com emissão comprovada |
| Integração operacional/substituição | BLOQUEADO | depende de nova autorização e controles futuros |

O candidato tecnicamente aceitável é a composição **sax@1.6.1 + guardas E2.7 +
validação E2.8**, não a biblioteca isolada. Recomenda-se manter `saxes` no baseline
atual, congelar essa PoC e avaliar integração controlada apenas em novo escopo autorizado.
Os guardas próprios aumentam responsabilidade de manutenção; dependem das posições e
eventos da versão SAX fixada. Atualizações devem repetir certificação e limites.
A leitura é de string UTF-8 completa, não de streaming/chunks; outra modalidade exigirá
ensaios adicionais. Nenhuma assinatura, autorização, situação ativa ou elegibilidade fiscal
foi inferida pelos testes. E3 e o dispatcher não foram iniciados.
'''
    (report / 'relatorio.md').write_text(text, encoding='utf-8')
    artifacts = []
    for folder in [ROOT / 'scripts/qa/nfse-national/e28', report]:
        for path in sorted(folder.rglob('*')):
            if path.is_file() and '__pycache__' not in path.parts and path.name != 'files.json':
                artifacts.append(dict(path=path.relative_to(ROOT).as_posix(), sha256=digest(path), bytes=path.stat().st_size))
    write('files.json', dict(scope='NEW_E28_FILES_ONLY', files=artifacts))
    print(json.dumps(dict(classification=result, gates=gates, summary=summary, fault=fault)))
    return 0 if result == 'PASS' else 1

if __name__ == '__main__':
    raise SystemExit(main())
