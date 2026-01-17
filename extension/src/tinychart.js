export function renderPayoffCurve(canvas, points, options = {}) {
  if (!canvas) {
    return;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  const width = canvas.width;
  const height = canvas.height;
  const padding = 12;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "rgba(255, 255, 255, 0.02)";
  ctx.fillRect(0, 0, width, height);

  const min = Math.min(...points.map((p) => p.y));
  const max = Math.max(...points.map((p) => p.y));
  const range = max - min || 1;

  const toX = (x, index) => {
    if (points.length === 1) {
      return padding;
    }
    return (
      padding + (index / (points.length - 1)) * (width - padding * 2)
    );
  };
  const toY = (y) =>
    height - padding - ((y - min) / range) * (height - padding * 2);

  ctx.strokeStyle = options.lineColor ?? "#ff8a2b";
  ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach((point, index) => {
    const x = toX(point.x, index);
    const y = toY(point.y);
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.stroke();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding, height - padding);
  ctx.lineTo(width - padding, height - padding);
  ctx.stroke();

  if (options.label) {
    ctx.fillStyle = "#8f96a3";
    ctx.font = "11px Space Grotesk, sans-serif";
    ctx.fillText(options.label, padding, padding + 8);
  }
}
