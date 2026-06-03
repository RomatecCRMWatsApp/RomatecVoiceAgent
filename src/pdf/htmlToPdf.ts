// v1.99.16 — Motor de renderizacao HTML→PDF (puppeteer) para os templates Prime.
//
// - Singleton de browser com pool implicito de paginas: nao abre/fecha Chromium
//   a cada PDF (custo de cold-start alto). Reaproveita a instancia.
// - Respeita PUPPETEER_EXECUTABLE_PATH (Railway/Docker com chromium do sistema).
// - A4 fullbleed (margens 0), printBackground, deviceScaleFactor 2.
//
// NAO substitui o pipeline pdfkit do template Padrao — e' usado apenas pelos
// geradores Prime I / Prime II (modulos paralelos).

import type { Browser, PDFOptions } from 'puppeteer';

let browserPromise: Promise<Browser> | null = null;

/** Args de launch — `--no-sandbox` exigido em containers (Railway/Docker). */
const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
];

/**
 * Retorna (ou cria sob demanda) o browser singleton. Se o Chromium do sistema
 * estiver em PUPPETEER_EXECUTABLE_PATH, usa-o; senao usa o bundle do puppeteer.
 *
 * Lanca erro descritivo se o Chromium nao for encontrado — o caller decide se
 * faz fallback pro template Padrao.
 */
export async function getBrowser(): Promise<Browser> {
  if (browserPromise) {
    // Revalida: se o browser anterior desconectou, recria.
    try {
      const b = await browserPromise;
      if (b.connected) return b;
    } catch {
      /* recria abaixo */
    }
    browserPromise = null;
  }

  browserPromise = (async () => {
    // import dinamico: nao arrasta o modulo no boot de quem so faz typecheck.
    const puppeteer = (await import('puppeteer')).default;
    const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
    return puppeteer.launch({
      headless: true,
      args: LAUNCH_ARGS,
      ...(executablePath ? { executablePath } : {}),
    });
  })();

  try {
    return await browserPromise;
  } catch (err) {
    browserPromise = null;
    throw new Error(
      `[htmlToPdf] falha ao iniciar Chromium: ${(err as Error).message}. ` +
        'Verifique a instalacao do puppeteer ou defina PUPPETEER_EXECUTABLE_PATH.',
    );
  }
}

const PDF_DEFAULTS: PDFOptions = {
  format: 'A4',
  printBackground: true,
  margin: { top: '0', right: '0', bottom: '0', left: '0' },
  preferCSSPageSize: true,
};

/**
 * Renderiza um documento HTML completo em um Buffer PDF (A4 fullbleed).
 * Abre uma pagina nova no browser singleton e a fecha ao final (libera memoria),
 * mantendo o browser vivo entre chamadas.
 */
export async function htmlToPdf(html: string, options?: Partial<PDFOptions>): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 }); // A4 @96dpi
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({ ...PDF_DEFAULTS, ...options });
    return Buffer.from(pdf);
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Fecha o browser singleton. Chamar em shutdown gracioso (SIGTERM) ou nos testes
 * que tenham aberto o Chromium, pra nao deixar processo zumbi.
 */
export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return;
  try {
    const b = await browserPromise;
    await b.close();
  } catch {
    /* ja fechado */
  } finally {
    browserPromise = null;
  }
}
