"""Local QA budgets, not production SLOs. Kill the child when wall/RSS/CPU exceeds a budget."""
import argparse
import hashlib
import json
import pathlib
import subprocess
import time

import psutil

ENGINES = ('saxes', 'sax')
WORKLOADS = ('document', 'nodes', 'large-text', 'depth', 'depth-over', 'nodes-over',
             'attributes-over', 'bytes-over', 'attack-depth', 'attack-nodes', 'attack-attributes', 'references', 'numeric-zeros', 'unknown-long')
BUDGETS = {'wall_seconds': 15, 'cpu_seconds': 10, 'rss_bytes': 512 * 1024 * 1024,
           'node_old_space_mib': 256, 'sampling_seconds': 0.05}


def measure(node, engine, workload):
    command = [node, '--max-old-space-size=256', '--expose-gc', '--import', 'tsx',
               'scripts/qa/nfse-national/e28/performance.mjs', engine, workload]
    start = time.monotonic()
    with subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE) as child:
        process = psutil.Process(child.pid)
        peak_rss = 0
        sampled_cpu = 0.0
        stop = None
        while child.poll() is None:
            try:
                peak_rss = max(peak_rss, process.memory_info().rss)
                cpu = process.cpu_times()
                sampled_cpu = cpu.user + cpu.system
            except psutil.NoSuchProcess:
                break
            elapsed = time.monotonic() - start
            if elapsed > BUDGETS['wall_seconds']:
                stop = 'WALL_BUDGET'
            elif peak_rss > BUDGETS['rss_bytes']:
                stop = 'RSS_BUDGET'
            elif sampled_cpu > BUDGETS['cpu_seconds']:
                stop = 'CPU_BUDGET'
            if stop:
                child.kill()
                break
            time.sleep(BUDGETS['sampling_seconds'])
        output, errors = child.communicate(timeout=5)
        base = {'engine': engine, 'workload': workload, 'process_seconds': time.monotonic() - start,
                'sampled_peak_rss': peak_rss, 'sampled_cpu_seconds': sampled_cpu,
                'exit_code': child.returncode, 'termination': stop}
        if child.returncode == 0:
            base.update(json.loads(output.decode('utf-8')))
        else:
            # Never publish a stack trace or arbitrary child output.
            base['stderr_bytes'] = len(errors)
            base['stderr_sha256'] = hashlib.sha256(errors).hexdigest()
            base['failure_category'] = ('NODE_HEAP_EXHAUSTED' if b'heap out of memory' in errors.lower()
                                        else 'QA_BUDGET_TERMINATION' if stop else 'CHILD_PROCESS_FAILED')
        base['budget_passed'] = stop is None and child.returncode == 0
        base['acceptance_passed'] = base.get('accepted') == base.get('expected_accepted') if child.returncode == 0 else False
        return base


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--node', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    output = pathlib.Path(args.output).resolve()
    if not output.parent.name.startswith('nfse-e28-'):
        raise RuntimeError('QA_OUTPUT_SCOPE_INVALID')
    version = subprocess.check_output([args.node, '-p', 'process.version'], text=True).strip()
    if not version.startswith('v22.'):
        raise RuntimeError('NODE_22_REQUIRED')
    rows = []
    for engine in ENGINES:
        for workload in WORKLOADS:
            row = measure(args.node, engine, workload)
            rows.append(row)
            print(json.dumps({'engine': engine, 'workload': workload, 'budget': row['budget_passed'],
                              'acceptance': row['acceptance_passed']}), flush=True)
    output.write_text(json.dumps({'node': version, 'budgets': BUDGETS,
        'psutil_version': psutil.__version__, 'observations': rows}, indent=2) + '\n', encoding='utf-8')
    return 0 if all(row['budget_passed'] and row['acceptance_passed'] for row in rows) else 1


if __name__ == '__main__':
    raise SystemExit(main())
