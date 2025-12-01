const LiekoDB = require('../liekodb');
const fs = require('fs');
const path = require('path');

const STORAGE_PATH = path.join(__dirname, 'data');

const CONFIG = {
  sizes: [10, 100, 1_000, 10_000, 50_000, 100_000, 250_000, 500_000],
  warmupRuns: 2,
  measuredRuns: 3,
};

class Benchmark {
  constructor() {
    this.db = null;
    this.results = new Map();
  }

  hrNow() { return process.hrtime.bigint(); }

  record(op, size, durationNs) {
    const key = `${op}_${size}`;
    if (!this.results.has(key)) this.results.set(key, []);
    this.results.get(key).push(Number(durationNs));
  }

  stats(durations) {
    if (durations.length === 0) return { avg: 0, min: 0, max: 0, p95: 0, p99: 0 };

    const sorted = [...durations].sort((a, b) => a - b);
    const sum = durations.reduce((a, b) => a + b, 0);
    const avg = sum / durations.length;

    return {
      avg,
      min: Math.min(...durations),
      max: Math.max(...durations),
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)],
    };
  }

  format(ns) {
    const ms = ns / 1_000_000;
    if (ms < 1) return `${(ns / 1000).toFixed(1)}µs`;
    if (ms < 100) return `${ms.toFixed(2)}ms`;
    return `${ms.toFixed(1)}ms`;
  }

  perDoc(ns, count) {
    const per = ns / count;
    if (per < 1000) return `${per.toFixed(1)}ns`;
    return `${(per / 1000).toFixed(2)}µs`;
  }

  async init() {
    if (fs.existsSync(STORAGE_PATH)) {
      fs.rmSync(STORAGE_PATH, { recursive: true, force: true });
    }
    fs.mkdirSync(STORAGE_PATH, { recursive: true });

    this.db = new LiekoDB({ storagePath: STORAGE_PATH, debug: false });
  }

  generateData(count) {
    const data = [];
    const countries = ['FR', 'UK', 'DE', 'ES', 'IT', 'US'];
    for (let i = 0; i < count; i++) {
      data.push({
        id: `user_${i}`,
        name: `User ${i}`,
        email: `user${i}@example.com`,
        age: 18 + (i % 60),
        active: i % 3 !== 0,
        score: Math.floor(Math.random() * 5000),
        role: i % 9 === 0 ? 'admin' : 'user',
        tags: i % 11 === 0 ? ['vip', 'beta'] : ['standard'],
        profile: {
          country: countries[i % countries.length],
          joined: new Date(Date.now() - i * 86400000).toISOString(),
        },
      });
    }
    return data;
  }

  async run() {
    console.log('LiekoDB — World-Class Performance Benchmark\n');
    await this.init();

    for (let r = 0; r < CONFIG.warmupRuns + CONFIG.measuredRuns; r++) {
      const isWarmup = r < CONFIG.warmupRuns;
      console.log(isWarmup
        ? `Warm-up ${r + 1}/${CONFIG.warmupRuns}`
        : `Measured run ${r - CONFIG.warmupRuns + 1}/${CONFIG.measuredRuns}`);

      for (const size of CONFIG.sizes) {
        const coll = this.db.collection(`bench_${size}`);
        const data = this.generateData(size);

        // INSERT
        const t1 = this.hrNow();
        await coll.insert(data);
        this.record('INSERT', size, this.hrNow() - t1);

        // FIND queries
        const queries = [
          [{}, 'all'],
          [{ active: true }, 'active'],
          [{ score: { $gte: 4000 } }, 'high_score'],
          [{
            active: true,
            score: { $gte: 3000 },
            'profile.country': { $in: ['FR', 'UK'] }
          }, 'complex'],
        ];

        for (const [q, name] of queries) {
          const t = this.hrNow();
          await coll.find(q);
          this.record(`FIND_${name}`, size, this.hrNow() - t);
        }

        // UPDATE
        const t2 = this.hrNow();
        await coll.update({ active: true }, { $inc: { score: 10 } });
        this.record('UPDATE', size, this.hrNow() - t2);

        await coll.drop();
      }
    }

    await this.db.close();
    this.printReport();
  }

  printReport() {
    console.log('\nLiekoDB — Performance Report\n');
    console.log('┌────────────────┬────────────┬──────────┬────────┬────────┬────────────┐');
    console.log('│ Operation      │ Documents  │ Average  │ P95    │ P99    │ Per Doc    │');
    console.log('├────────────────┼────────────┼──────────┼────────┼────────┼────────────┤');

    const ops = ['INSERT', 'FIND_all', 'FIND_complex', 'UPDATE'];
    for (const op of ops) {
      let first = true;
      for (const size of CONFIG.sizes) {
        const key = `${op}_${size}`;
        if (!this.results.has(key)) continue;

        const s = this.stats(this.results.get(key));
        const name = op === 'INSERT' ? 'INSERT' :
                     op === 'UPDATE' ? 'UPDATE' :
                     op === 'FIND_all' ? 'FIND (full)' : 'FIND (complex)';

        if (first) {
          console.log(`│ ${name.padEnd(14)} │ ${size.toLocaleString().padEnd(10)} │ ${this.format(s.avg).padEnd(8)} │ ${this.format(s.p95).padEnd(6)} │ ${this.format(s.p99).padEnd(6)} │ ${this.perDoc(s.avg, size).padEnd(10)} │`);
          first = false;
        } else {
          console.log(`│                │ ${size.toLocaleString().padEnd(10)} │ ${this.format(s.avg).padEnd(8)} │ ${this.format(s.p95).padEnd(6)} │ ${this.format(s.p99).padEnd(6)} │ ${this.perDoc(s.avg, size).padEnd(10)} │`);
        }
      }
      if (op !== ops[ops.length - 1]) {
        console.log('├────────────────┼────────────┼──────────┼────────┼────────┼────────────┤');
      }
    }
    console.log('└────────────────┴────────────┴──────────┴────────┴────────┴────────────┘');

    const i100k = this.stats(this.results.get('INSERT_100000') || []);
    const c100k = this.stats(this.results.get('FIND_complex_100000') || []);

    console.log('\nHighlight — 100 000 documents');
    console.log(`   • Bulk Insert       : ${this.format(i100k.avg)}  (${this.perDoc(i100k.avg, 100000)}/doc)`);
    console.log(`   • Complex Query     : ${this.format(c100k.avg)}`);
    console.log(`   • Peak throughput   : ${Math.round(100_000 / (i100k.avg / 1_000_000_000)).toLocaleString()} docs/sec\n`);

    console.log('LiekoDB · Pure JavaScript · Zero dependencies · Production ready');
  }
}

new Benchmark().run().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});