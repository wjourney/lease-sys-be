import { Injectable } from "@nestjs/common";
import { chromium } from "playwright";
const esc = (v: any) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
@Injectable()
export class PdfService {
  html(title: string, items: any[], body = "", compact = false) {
    return `<!doctype html><html lang="zh"><head><meta charset="UTF-8"><style>body{font:${compact ? 12 : 14}px -apple-system,"PingFang SC",sans-serif;color:#17263f;padding:${compact ? 26 : 42}px}header{border-bottom:3px solid #b28c54;padding-bottom:${compact ? 12 : 24}px}h1{font-size:${compact ? 23 : 28}px;margin:${compact ? 14 : 24}px 0}small{color:#718096}table{width:100%;border-collapse:collapse;margin-top:${compact ? 16 : 28}px}td{border-bottom:1px solid #e8ecf2;padding:${compact ? "8px 12px" : "15px"}}td:first-child{width:30%;color:#6b7280}article{white-space:pre-wrap;line-height:${compact ? 1.6 : 1.9};margin-top:${compact ? 18 : 30}px}footer{margin-top:${compact ? 22 : 48}px;color:#9aa4b2}</style></head><body><header><strong>SUPREME BAY</strong><br><small>租赁管理系统</small></header><h1>${esc(title)}</h1><table>${items.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table><article>${esc(body)}</article><footer>SUPREME BAY · ${new Date().toISOString().slice(0, 10)}</footer></body></html>`;
  }
  async pdf(html: string) {
    const browser = await chromium.launch({
      headless: true,
      ...(process.env.CHROME_EXECUTABLE
        ? { executablePath: process.env.CHROME_EXECUTABLE }
        : {}),
    });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "load" });
      return await page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "16mm", bottom: "16mm" },
      });
    } finally {
      await browser.close();
    }
  }
}
