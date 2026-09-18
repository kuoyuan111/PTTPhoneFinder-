import type { SearchResult } from "@/lib/types";

function parsedDate(value: string): Date | string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date;
}

export async function buildResultsWorkbook(results: SearchResult[]): Promise<ArrayBuffer> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "PTT Phone Finder Web";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("搜尋結果", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  sheet.columns = [
    { header: "來源看板", key: "board", width: 16 },
    { header: "發文時間", key: "publishedAt", width: 22 },
    { header: "手機型號/命中關鍵字", key: "model", width: 25 },
    { header: "容量", key: "storage", width: 13 },
    { header: "價格", key: "price", width: 13 },
    { header: "價格候選", key: "pricesFound", width: 22 },
    { header: "顏色", key: "color", width: 15 },
    { header: "售出狀態", key: "soldStatus", width: 12 },
    { header: "地區", key: "locations", width: 18 },
    { header: "商品狀況", key: "condition", width: 48 },
    { header: "原始標題", key: "title", width: 55 },
    { header: "文章 URL", key: "url", width: 25 },
    { header: "作者", key: "author", width: 15 },
    { header: "文章內容", key: "content", width: 80 },
  ];

  for (const result of results) {
    const row = sheet.addRow({
      board: result.board,
      publishedAt: parsedDate(result.publishedAt) || result.listDate,
      model: result.model,
      storage: result.storage,
      price: result.price,
      pricesFound: result.pricesFound.map((price) => price.toLocaleString("zh-TW")).join("、"),
      color: result.color,
      soldStatus: result.soldStatus,
      locations: result.locations.join("、"),
      condition: result.condition,
      title: result.title,
      url: { text: "開啟 PTT 原文", hyperlink: result.url },
      author: result.author,
      content: result.content,
    });
    if (result.sold) row.getCell("soldStatus").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFCE4D6" } };
  }

  const header = sheet.getRow(1);
  header.height = 24;
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF17324D" } };
  header.alignment = { vertical: "middle", horizontal: "center" };
  sheet.autoFilter = { from: "A1", to: `N${Math.max(sheet.rowCount, 1)}` };

  sheet.getColumn("publishedAt").numFmt = "yyyy-mm-dd hh:mm:ss";
  sheet.getColumn("price").numFmt = "#,##0";
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) {
      row.alignment = { vertical: "top", wrapText: true };
      if (rowNumber % 2 === 1) {
        row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F7FA" } };
      }
    }
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const bytes = new Uint8Array(buffer.byteLength);
  bytes.set(new Uint8Array(buffer));
  return bytes.buffer;
}

export async function downloadResultsExcel(results: SearchResult[]): Promise<void> {
  const bytes = await buildResultsWorkbook(results);
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `PTT手機搜尋_${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}
