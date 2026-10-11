"""Run local quality checks with an explicit Node 22 and private logs."""
import argparse
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[4]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--node', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--lf-checkout', required=True)
    args = parser.parse_args()
    output = pathlib.Path(args.output).resolve()
    lf = pathlib.Path(args.lf_checkout).resolve()
    assert output.name.startswith('nfse-e28-')
    assert subprocess.check_output([args.node, '-p', 'process.version'], text=True).startswith('v22.')
    assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=lf, text=True).strip() == '364c5ad2db6db9134be9e08added44299fff7a87'
    jobs = [
        ('fault-control', ROOT, [args.node, 'node_modules/vitest/vitest.mjs', 'run', '--config',
          'scripts/qa/nfse-national/e28/vitest.config.mjs', 'scripts/qa/nfse-national/e28/security.test.mjs',
          '--reporter=json', '--outputFile=' + str(output / 'fault-control.json')]),
        ('types-poc', ROOT, [args.node, 'node_modules/typescript/bin/tsc', '-p', 'scripts/qa/nfse-national/e28/tsconfig.json']),
        ('types-root', ROOT, [args.node, 'node_modules/typescript/bin/tsc', '--noEmit', '--incremental', 'false']),
        ('lint', ROOT, [args.node, 'node_modules/eslint/bin/eslint.js', 'scripts/qa/nfse-national/e28', '--max-warnings', '0']),
        ('e1-e2', ROOT, [args.node, 'node_modules/vitest/vitest.mjs', 'run', 'src/lib/nfse/canonical',
          'src/lib/nfse/xml-nacional', '--reporter=json', '--outputFile=' + str(output / 'e1-e2.json')]),
        ('regression-lf', lf, [args.node, 'node_modules/vitest/vitest.mjs', 'run', '--reporter=json',
          '--outputFile=' + str(output / 'regression-lf.json')]),
        ('python', ROOT, [sys.executable, '-m', 'py_compile', *map(str, (ROOT / 'scripts/qa/nfse-national/e28').glob('*.py'))]),
        ('diff', ROOT, ['git', 'diff', '--check']),
    ]
    import os
    env = dict(os.environ, BW_NFSE_E28_OUTPUT=str(output), BW_NFSE_E28_PARSER='sax-e27',
               BW_NFSE_E25_PRIVATE=str(output.parent / 'nfse-e25-20261009'))
    rows = []
    for name, cwd, command in jobs:
        with (output / (name + '.log')).open('wb') as log:
            completed = subprocess.run(command, cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT, check=False)
        row = dict(check=name, exit_code=completed.returncode,
                   passed=(completed.returncode != 0 if name == 'fault-control' else completed.returncode == 0))
        rows.append(row)
        print(json.dumps(row), flush=True)
    (output / 'quality.json').write_text(json.dumps(rows, indent=2) + '\n', encoding='utf-8')
    return 0 if all(r['passed'] for r in rows) else 1

if __name__ == '__main__':
    raise SystemExit(main())
