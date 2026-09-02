import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const REPOSITORY = fileURLToPath(new URL('..', import.meta.url))
const ASSETS = join(REPOSITORY, 'docs/assets')

async function dataUrl(path) {
  return `data:image/png;base64,${(await readFile(path)).toString('base64')}`
}

function documentHtml({ width, height, background, screenshot, social }) {
  const titleSize = social ? 68 : 82
  const copySize = social ? 24 : 30
  const copyWidth = social ? '500px' : '48%'
  const productWidth = social ? 630 : 690
  const productHeight = social ? 440 : 470
  const productRight = social ? -90 : -85
  return `<!doctype html>
  <html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #07101f; }
    #canvas {
      position: relative; width: ${width}px; height: ${height}px; overflow: hidden;
      background: #07101f url('${background}') center / cover no-repeat;
      color: #f7fbff; font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    #canvas::after {
      content: ""; position: absolute; inset: 0;
      background: linear-gradient(90deg, rgba(4, 10, 22, .96) 0%, rgba(5, 12, 25, .83) 42%, rgba(4, 10, 22, .18) 70%, rgba(4, 10, 22, .42) 100%);
    }
    .copy { position: absolute; z-index: 2; left: 72px; top: 50%; width: ${copyWidth}; transform: translateY(-50%); }
    .eyebrow { display: inline-flex; align-items: center; gap: 9px; margin-bottom: 22px; color: #8fc5ff; font-size: 17px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
    .eyebrow::before { content: ""; width: 28px; height: 2px; background: #4f9cff; box-shadow: 0 0 16px #4f9cff; }
    h1 { margin: 0; font-size: ${titleSize}px; line-height: .98; letter-spacing: -.055em; }
    p { margin: 25px 0 0; max-width: 610px; color: #d4e4f7; font-size: ${copySize}px; font-weight: 520; line-height: 1.28; letter-spacing: -.025em; }
    .pills { display: flex; gap: 10px; margin-top: 31px; }
    .pill { padding: 8px 13px; border: 1px solid rgba(116, 180, 255, .34); border-radius: 999px; background: rgba(8, 21, 42, .66); color: #b9d9ff; font-size: 14px; font-weight: 750; letter-spacing: .08em; }
    .product {
      position: absolute; z-index: 2; right: ${productRight}px; top: 50%; width: ${productWidth}px; height: ${productHeight}px;
      transform: translateY(-50%) rotate(-1.2deg); overflow: hidden; border-radius: 19px;
      border: 1px solid rgba(125, 185, 255, .38); background: #090d15;
      box-shadow: 0 36px 90px rgba(0, 0, 0, .58), 0 0 55px rgba(36, 125, 255, .18);
    }
    .product::before { content: ""; position: absolute; z-index: 2; inset: 0; box-shadow: inset 0 0 0 1px rgba(255,255,255,.06); pointer-events: none; }
    .product img { width: 100%; height: 100%; object-fit: cover; object-position: 50% 48%; filter: saturate(.93) contrast(1.04); }
    .brand-dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: #59a7ff; box-shadow: 0 0 18px #59a7ff; }
  </style></head><body><div id="canvas">
    <div class="copy">
      <div class="eyebrow"><span class="brand-dot"></span> Local-first for DeepSeek Harness</div>
      <h1>dsh-explain</h1>
      <p>Turn everyday work into a private, continuous learning loop.</p>
      <div class="pills"><span class="pill">CAPTURE</span><span class="pill">REVIEW</span><span class="pill">ADAPT</span></div>
    </div>
    <div class="product"><img src="${screenshot}" alt=""></div>
  </div></body></html>`
}

async function render(page, options) {
  await page.setViewportSize({ width: options.width, height: options.height })
  await page.setContent(documentHtml(options), { waitUntil: 'load' })
  await page.locator('#canvas').screenshot({ path: options.output, animations: 'disabled' })
}

const background = await dataUrl(join(ASSETS, 'learning-loop-background.png'))
const screenshot = await dataUrl(join(ASSETS, 'demo-profile.png'))
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 })
  await render(page, {
    width: 1600, height: 720, background, screenshot, social: false,
    output: join(ASSETS, 'showcase-hero.png'),
  })
  await render(page, {
    width: 1280, height: 640, background, screenshot, social: true,
    output: join(ASSETS, 'social-preview.png'),
  })
} finally {
  await browser.close()
}
