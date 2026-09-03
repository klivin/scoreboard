import { ChartView, StatsView, SignalsView } from './view.js';
import { AppController } from './controller.js';
import { InvestmentsController } from './investments/controller.js';
import { ForecastsController } from './forecasts/controller.js';
import { ScannerController } from './scanner/controller.js';

const views = {
  chart: new ChartView('chart'),
  stats: new StatsView('stats-container'),
  signals: new SignalsView('signals-grid')
};

const controller = new AppController(views);
const investments = new InvestmentsController({
  onChange: () => {
    controller.syncInvestmentMarkers();
    if (controller.forecasts) controller.forecasts.refresh();
    if (controller.scanner) controller.scanner.render();
  }
});
controller.investments = investments;

const forecasts = new ForecastsController({
  investmentsStore: investments.store,
  onJump: (payload) => controller.openForecastOnOverview(payload),
  onGenerate: async () => {
    const symbol = controller.getSelectedSymbol();
    const horizonSelect = document.getElementById('horizon-select');
    const horizon = horizonSelect ? horizonSelect.value : 'weekly';
    await controller.handleGenerateForecast(symbol, horizon);
  }
});
controller.forecasts = forecasts;

const scanner = new ScannerController({
  app: controller,
  investments
});
controller.scanner = scanner;

controller.init();
investments.init();
