function toUnixSeconds(isoDate) {
  if (!isoDate) return null;
  const stamp = Date.parse(`${isoDate}T00:00:00Z`);
  if (!Number.isFinite(stamp)) return null;
  return Math.floor(stamp / 1000);
}

export function buildTransactionMarker(event) {
  const date = event.activityDate || event.transactionDate || null;
  return {
    id: event.id,
    time: toUnixSeconds(date),
    date,
    symbol: event.symbol,
    quantity: event.quantity,
    price: event.price,
    fees: event.commission,
    amount: event.amount,
    source: event.source,
    badge: event.badge,
    activityType: event.activityType,
    description: event.description,
    flags: event.flags || {},
    noFillInferred: Boolean(event.flags && event.flags.noFillInferred)
  };
}

export function buildTransactionMarkers(events, symbol) {
  const want = symbol ? String(symbol).toUpperCase() : null;
  return (events || [])
    .filter((event) => {
      if (!event) return false;
      if (want && String(event.symbol || '').toUpperCase() !== want) return false;
      return Boolean(event.activityDate || event.transactionDate);
    })
    .map(buildTransactionMarker)
    .filter((marker) => marker.time != null);
}

export function formatMarkerDetail(marker) {
  const qty = marker.quantity == null ? 'missing' : String(marker.quantity);
  const price = marker.price == null ? 'missing' : String(marker.price);
  const fees = marker.fees == null ? 'missing' : String(marker.fees);
  return {
    title: `${marker.badge} ${String(marker.activityType || '').toUpperCase()} ${marker.symbol || ''}`.trim(),
    lines: [
      `Date: ${marker.date || 'missing'}`,
      `Qty: ${qty}`,
      `Price: ${price}`,
      `Fees: ${fees}`,
      `Source: ${marker.source || 'missing'}`,
      `Badge: ${marker.badge}`
    ]
  };
}

export function toChartMarker(marker) {
  const isBuy = marker.activityType === 'buy';
  const isSell = marker.activityType === 'sell';
  const tracking = marker.badge === 'TRACKING';
  return {
    time: marker.time,
    position: isBuy ? 'belowBar' : 'aboveBar',
    color: tracking ? '#d97706' : (isSell ? '#ef4444' : (isBuy ? '#059669' : '#6366f1')),
    shape: isBuy ? 'arrowUp' : (isSell ? 'arrowDown' : 'circle'),
    text: `${marker.badge} ${String(marker.activityType || '').toUpperCase()}`
  };
}
