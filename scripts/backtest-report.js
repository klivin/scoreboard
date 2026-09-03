#!/usr/bin/env node
/**
 * Regenerate backtest report and export JSON/CSV from current data.
 * Usage: npm run backtest [-- --symbol BTC --horizon weekly]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  runFullBacktest,
  loadBacktestSeries,
  formatBacktestReport
} from '../src/model/backtest.js';
import { DEFAULT_ENABLED } from '../src/model/signals/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '../store');

function parseArgs(argv) {
  const args = { symbol: 'BTC', horizon: 'weekly', eth: true };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--symbol' && argv[i + 1]) args.symbol = argv[++i];
    else if (argv[i] === '--horizon' && argv[i + 1]) args.horizon = argv[++i];
    else if (argv[i] === '--no-eth') args.eth = false;
  }
  return args;
}

function exportTradesCsv(result, filepath) {
  const rows = [['strategy', 'entry_ts', 'exit_ts', 'entry_price', 'exit_price', 'pnl_fraction']];
  for (const [id, stats] of Object.entries(result.strategies)) {
    for (const t of stats.trades || []) {
      rows.push([
        id,
        t.entryTimestamp,
        t.exitTimestamp,
        t.entryPrice,
        t.exitPrice,
        t.pnlFraction
      ]);
    }
  }
  fs.writeFileSync(filepath, rows.map((r) => r.join(',')).join('\n'));
}

async function main() {
  const args = parseArgs(process.argv);
  const symbols = [args.symbol];
  if (args.eth) symbols.push('ETH');

  const reports = [];

  for (const symbol of symbols) {
    const { series, dataSource } = loadBacktestSeries(symbol);
    const result = runFullBacktest(series, {
      symbol,
      horizon: args.horizon,
      enabled: DEFAULT_ENABLED,
      dataSource
    });

    if (result.error) {
      console.warn(`${symbol}: ${result.error}`);
      continue;
    }

    reports.push(result);
    const reportMd = formatBacktestReport(result);
    console.log(reportMd);
    console.log('\n');

    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const base = `backtest_${symbol}_${args.horizon}`;
    fs.writeFileSync(path.join(outDir, `${base}.json`), JSON.stringify(result, null, 2));
    exportTradesCsv(result, path.join(outDir, `${base}_trades.csv`));
    fs.writeFileSync(path.join(outDir, `${base}_report.md`), reportMd);
    console.error(`Wrote ${base}.json, ${base}_trades.csv, ${base}_report.md to store/`);
  }

  if (reports.length === 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
