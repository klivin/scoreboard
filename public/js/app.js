import { ChartView, StatsView, SignalsView, ForecastView, UniverseView } from './view.js';
import { AppController } from './controller.js';
import { InvestmentsController } from './investments/controller.js';

const views = {
  chart: new ChartView('chart'),
  stats: new StatsView('stats-container'),
  signals: new SignalsView('signals-grid'),
  forecast: new ForecastView('forecast-cards'),
  universe: new UniverseView('universe-info', 'universe-list')
};

const controller = new AppController(views);
const investments = new InvestmentsController({
  onChange: () => controller.syncInvestmentMarkers()
});
controller.investments = investments;

controller.init();
investments.init();
