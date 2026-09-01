class CloudRenderer {
  constructor() {
    this.points = [];
  }

  draw(target) {
    const points = this.points;
    if (!points || points.length < 2) return;
    target.useMediaCoordinateSpace((scope) => {
      const ctx = scope.context;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y1);
      for (const point of points) {
        ctx.lineTo(point.x, point.y1);
      }
      for (let i = points.length - 1; i >= 0; i--) {
        ctx.lineTo(points[i].x, points[i].y2);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(102, 126, 234, 0.14)';
      ctx.fill();
    });
  }
}

class CloudPaneView {
  constructor(source) {
    this.source = source;
    this.rendererImpl = new CloudRenderer();
  }

  zOrder() {
    return 'bottom';
  }

  update() {
    const series = this.source.series;
    const chart = this.source.chart;
    const senkouA = this.source.senkouA || [];
    const senkouB = this.source.senkouB || [];
    if (!series || !chart) {
      this.rendererImpl.points = [];
      return;
    }
    const timeScale = chart.timeScale();
    const points = [];
    const n = Math.min(senkouA.length, senkouB.length);
    for (let i = 0; i < n; i++) {
      const a = senkouA[i];
      const b = senkouB[i];
      if (!a || !b || !Number.isFinite(a.value) || !Number.isFinite(b.value)) continue;
      const x = timeScale.timeToCoordinate(a.time);
      const y1 = series.priceToCoordinate(a.value);
      const y2 = series.priceToCoordinate(b.value);
      if (x == null || y1 == null || y2 == null) continue;
      points.push({ x, y1, y2 });
    }
    this.rendererImpl.points = points;
  }

  renderer() {
    return this.rendererImpl;
  }
}

export class IchimokuCloudPrimitive {
  constructor() {
    this.senkouA = [];
    this.senkouB = [];
    this.chart = null;
    this.series = null;
    this.views = [new CloudPaneView(this)];
  }

  setSpans(senkouA, senkouB) {
    this.senkouA = senkouA || [];
    this.senkouB = senkouB || [];
  }

  attached(params) {
    this.chart = params.chart;
    this.series = params.series;
  }

  detached() {
    this.chart = null;
    this.series = null;
  }

  updateAllViews() {
    this.views.forEach((view) => view.update());
  }

  paneViews() {
    return this.views;
  }
}
