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
  html(title: string, items: any[], body = "") {
    return `<!doctype html><html lang="zh"><head><meta charset="UTF-8"><style>body{font:14px -apple-system,"PingFang SC",sans-serif;color:#17263f;padding:42px}header{border-bottom:3px solid #b28c54;padding-bottom:24px}h1{font-size:28px;margin:24px 0}small{color:#718096}table{width:100%;border-collapse:collapse;margin-top:28px}td{border-bottom:1px solid #e8ecf2;padding:15px}td:first-child{width:30%;color:#6b7280}article{white-space:pre-wrap;line-height:1.9;margin-top:30px}footer{margin-top:48px;color:#9aa4b2}</style></head><body><header><strong>SUPREME BAY</strong><br><small>租赁管理系统</small></header><h1>${esc(title)}</h1><table>${items.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table><article>${esc(body)}</article><footer>SUPREME BAY · ${new Date().toISOString().slice(0, 10)}</footer></body></html>`;
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
