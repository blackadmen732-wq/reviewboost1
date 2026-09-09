/**
 * Quiet blank page for owners who will design in another app.
 * Guides only — no pizza, no logo, no half-made graphic.
 */

export function downloadBlankCustomerTemplate(): void {
  const width = 1080;
  const height = 1920;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.fillStyle = "#F8F5F0";
  ctx.fillRect(0, 0, width, height);

  const cardTop = Math.round(height * 0.58);
  ctx.fillStyle = "#FFFFFF";
  roundRect(ctx, 0, cardTop, width, height - cardTop, 72);
  ctx.fill();

  ctx.strokeStyle = "rgba(23, 26, 24, 0.12)";
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 12]);

  // Hero safe area
  ctx.strokeRect(64, 64, width - 128, cardTop - 128);
  // Card copy band
  ctx.strokeRect(96, cardTop + 80, width - 192, 280);

  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(93, 101, 95, 0.45)";
  ctx.font = "28px Geist, ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Photo goes here", width / 2, cardTop / 2);
  ctx.fillText("Stars stay here", width / 2, cardTop + 220);

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "reviewboost-customer-page-blank.png";
    link.click();
    URL.revokeObjectURL(url);
  }, "image/png");
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, 0);
  ctx.arcTo(x, y + h, x, y, 0);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
