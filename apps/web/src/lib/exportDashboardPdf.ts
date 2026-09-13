import { jsPDF } from "jspdf";
import type { Chart } from "chart.js";

export interface DashboardPdfInput {
  generatedAt: Date;
  totals: {
    uploaded: number;
    completed: number;
    failed: number;
    processing: number;
    analyzed: number;
    matched: number;
    avgConfidence: string;
    words: number;
  };
  filters: Array<{ label: string; value: string }>;
  charts: Array<{
    title: string;
    chart: Chart | null;
  }>;
}

function chartImage(chart: Chart | null): string | null {
  if (!chart) return null;
  try {
    return chart.toBase64Image("image/png", 1);
  } catch {
    return null;
  }
}

export async function exportDashboardPdf(
  input: DashboardPdfInput,
): Promise<void> {
  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - margin) {
      pdf.addPage();
      y = margin;
    }
  };

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(18);
  pdf.setTextColor(20, 40, 30);
  pdf.text("OCR · Dashboard encuesta KAP", margin, y);
  y += 8;

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.setTextColor(80, 90, 85);
  pdf.text(
    `Generado: ${input.generatedAt.toLocaleString("es-CO")}`,
    margin,
    y,
  );
  y += 10;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  pdf.setTextColor(20, 40, 30);
  pdf.text("Totales", margin, y);
  y += 6;

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.setTextColor(30, 40, 35);
  const totalsLines = [
    `Documentos procesados (analizados): ${input.totals.analyzed}`,
    `Documentos que coinciden con el filtro: ${input.totals.matched}`,
    `Uploaded: ${input.totals.uploaded} · Completed: ${input.totals.completed} · Failed: ${input.totals.failed} · Processing: ${input.totals.processing}`,
    `Confianza OCR promedio (filtro): ${input.totals.avgConfidence} · Palabras: ${input.totals.words}`,
  ];
  for (const line of totalsLines) {
    ensureSpace(6);
    pdf.text(line, margin, y);
    y += 5.5;
  }
  y += 4;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  pdf.setTextColor(20, 40, 30);
  ensureSpace(10);
  pdf.text("Filtros aplicados", margin, y);
  y += 6;

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.setTextColor(30, 40, 35);
  if (input.filters.length === 0) {
    ensureSpace(6);
    pdf.text("Sin filtros — se incluyen todos los documentos analizados.", margin, y);
    y += 6;
  } else {
    for (const filter of input.filters) {
      ensureSpace(6);
      pdf.text(`• ${filter.label}: ${filter.value}`, margin, y);
      y += 5.5;
    }
  }
  y += 6;

  pdf.setDrawColor(200, 210, 205);
  pdf.line(margin, y, pageWidth - margin, y);
  y += 8;

  for (const entry of input.charts) {
    const dataUrl = chartImage(entry.chart);
    if (!dataUrl) continue;

    const imgWidth = contentWidth;
    const imgHeight = Math.min(85, contentWidth * 0.55);
    ensureSpace(imgHeight + 14);

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(11);
    pdf.setTextColor(20, 40, 30);
    pdf.text(entry.title, margin, y);
    y += 5;

    pdf.addImage(dataUrl, "PNG", margin, y, imgWidth, imgHeight);
    y += imgHeight + 8;
  }

  const stamp = input.generatedAt
    .toISOString()
    .slice(0, 19)
    .replace(/[:T]/g, "-");
  pdf.save(`ocr-dashboard-${stamp}.pdf`);
}
