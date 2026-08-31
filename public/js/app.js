import { ChartView, StatsView, ForecastView, UniverseView } from './view.js';
import { AppController } from './controller.js';

const views = {
  chart: new ChartView('chart'),
  stats: new StatsView('stats-container'),
  forecast: new ForecastView('forecast-cards'),
  universe: new UniverseView('universe-info', 'universe-list')
};

const controller = new AppController(views);

controller.init();
