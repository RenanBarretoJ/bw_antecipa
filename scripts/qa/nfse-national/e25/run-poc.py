"""Reproducible Node 22 PoC and isolated-process performance measurements."""
import argparse
import json
import os
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]


def run(node, private):
    current = subprocess.check_output([node, '--version'], text=True).strip()
    if not current.startswith('v22.'):
        raise ValueError('NODE_22_REQUIRED')
    if not (private / 'public-samples.json').is_file():
        raise ValueError('PINNED_PRIVATE_MANIFEST_REQUIRED')
    for engine in ['saxes', 'sax']:
        env = dict(os.environ, BW_NFSE_E25_PARSER=engine, BW_NFSE_E25_PRIVATE_DIR=str(private))
        result = subprocess.run([node, 'node_modules/vitest/vitest.mjs', 'run',
            '--config', 'scripts/qa/nfse-national/e25/vitest.config.mjs', '--maxWorkers', '1',
            '--reporter', 'json', '--outputFile', str(private / ('tests-'+engine+'.json'))],
            env=env, cwd=REPO, capture_output=True, timeout=120)
        (private / ('tests-'+engine+'.log')).write_bytes(result.stdout+result.stderr)
        if result.returncode:
            raise ValueError('POC_HARNESS_FAILED: '+engine)
    performance = []
    for workload in ['document', 'nodes', 'large-text', 'depth']:
        for engine in ['saxes', 'sax']:
            process = subprocess.run([node, '--expose-gc', '--import', 'tsx',
                'scripts/qa/nfse-national/e25/performance.mjs', engine, workload], cwd=REPO,
                capture_output=True, text=True, timeout=60, check=True)
            measurement = json.loads(process.stdout)
            performance.append(measurement)
            print(engine, workload, 'median_ms', round(measurement['median_ms'], 3) if measurement['median_ms'] is not None else None,
                  'max_rss_MiB', round(measurement['max_rss_kib']/1024, 1), 'error', measurement['error'], flush=True)
    (private / 'performance.json').write_text(json.dumps(performance, indent=2)+'\n', encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--node', type=str, required=True)
    parser.add_argument('--private-directory', type=Path, required=True)
    args = parser.parse_args()
    run(args.node, args.private_directory.resolve())
