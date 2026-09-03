import { ChartView, StatsView, SignalsView, ForecastView } from './view.js';
import { AppController } from './controller.js';
import { InvestmentsController } from './investments/controller.js';
import { ScannerController } from './scanner/controller.js';

const views = {
  chart: new ChartView('chart'),
  stats: new StatsView('stats-container'),
  signals: new SignalsView('signals-grid'),
  forecast: new ForecastView('forecast-cards')
};

const controller = new AppController(views);
const investments = new InvestmentsController({
  onChange: () => {
    controller.syncInvestmentMarkers();
    if (controller.scanner) controller.scanner.render();
  }
});
controller.investments = investments;

const scanner = new ScannerController({
  app: controller,
  investments
});
controller.scanner = scanner;

controller.init();
investments.init();
