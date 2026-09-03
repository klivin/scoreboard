import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  handleGetSeries,
  handleGetIndicators,
  handleGetForecast,
  handleGetMissing,
  handleGetUniverse,
  handleGetForecasts,
  handleGetSignals,
  handleGetPredictedSeries,
  handleGetSymbols,
  handleGetTradingSignals,
  handleGetBacktest
} from './controller/api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));
app.use(
  '/vendor/lightweight-charts',
  express.static(path.join(__dirname, '../node_modules/lightweight-charts/dist'))
);

app.get('/api/series', handleGetSeries);
app.get('/api/indicators', handleGetIndicators);
app.get('/api/forecast', handleGetForecast);
app.get('/api/missing', handleGetMissing);
app.get('/api/universe', handleGetUniverse);
app.get('/api/forecasts', handleGetForecasts);
app.get('/api/signals', handleGetSignals);
app.get('/api/predicted-series', handleGetPredictedSeries);
app.get('/api/symbols', handleGetSymbols);
app.get('/api/trading-signals', handleGetTradingSignals);
app.get('/api/backtest', handleGetBacktest);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.listen(PORT, () => {
  console.log(`Scoreboard server running on http://localhost:${PORT}`);
});

export default app;
