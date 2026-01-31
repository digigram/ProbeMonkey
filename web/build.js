#!/usr/bin/env node
// ---------------------------------------------------------------------------
// ProbeMonkey Web UI — Build script
// Inlines CSS + JS into index.html, minifies, and optionally gzips.
// Output: ../data/index.html (and ../data/index.html.gz)
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SRC = path.join(__dirname, 'src');
const DATA = path.join(__dirname, '..', 'data');

// JS files in dependency order
const JS_FILES = [
  'constants.js',
  'adc.js',
  'websocket.js',
  'scope.js',
  'settings.js',
];

async function build() {
  // Ensure data/ exists
  if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });

  // Read source files
  let html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(SRC, 'style.css'), 'utf8');
  const jsFiles = JS_FILES.map(f => fs.readFileSync(path.join(SRC, f), 'utf8'));
  const jsConcat = jsFiles.join('\n');

  console.log('Source sizes:');
  console.log('  HTML:  ' + Buffer.byteLength(html) + ' bytes');
  console.log('  CSS:   ' + Buffer.byteLength(css) + ' bytes');
  console.log('  JS:    ' + Buffer.byteLength(jsConcat) + ' bytes');

  // Try to minify; fall back to raw if minifiers unavailable
  let minCss = css;
  let minJs = jsConcat;
  let minHtml;

  try {
    const CleanCSS = require('clean-css');
    minCss = new CleanCSS({}).minify(css).styles;
    console.log('  CSS minified: ' + Buffer.byteLength(minCss) + ' bytes');
  } catch (e) {
    console.log('  (clean-css not available, using raw CSS)');
  }

  try {
    const { minify } = require('terser');
    const result = await minify(jsConcat, { compress: true, mangle: true });
    if (result.code) {
      minJs = result.code;
      console.log('  JS minified:  ' + Buffer.byteLength(minJs) + ' bytes');
    }
  } catch (e) {
    console.log('  (terser not available, using raw JS)');
  }

  // Inline CSS: replace <link rel="stylesheet" ...> with <style>...</style>
  html = html.replace(
    /<!-- INLINE_CSS -->\s*<link[^>]*style\.css[^>]*>/,
    '<style>' + minCss + '</style>'
  );

  // Inline JS: replace all <script src="..."> with single <script>...</script>
  html = html.replace(
    /<!-- INLINE_JS -->[\s\S]*$/,
    '<script>' + minJs + '</script>\n</body>\n</html>'
  );

  try {
    const { minify: minifyHtml } = require('html-minifier-terser');
    minHtml = await minifyHtml(html, {
      collapseWhitespace: true,
      removeComments: true,
      removeRedundantAttributes: true,
      minifyCSS: false, // already minified
      minifyJS: false,  // already minified
    });
    console.log('  HTML minified: ' + Buffer.byteLength(minHtml) + ' bytes');
  } catch (e) {
    minHtml = html;
    console.log('  (html-minifier-terser not available, using raw HTML)');
  }

  // Write uncompressed
  const outPath = path.join(DATA, 'index.html');
  fs.writeFileSync(outPath, minHtml, 'utf8');
  const uncompressedSize = Buffer.byteLength(minHtml, 'utf8');
  console.log('\nOutput: ' + outPath);
  console.log('  Uncompressed: ' + uncompressedSize + ' bytes');

  // Write gzipped
  const gzipped = zlib.gzipSync(Buffer.from(minHtml, 'utf8'), { level: 9 });
  const gzPath = path.join(DATA, 'index.html.gz');
  fs.writeFileSync(gzPath, gzipped);
  console.log('  Gzipped:      ' + gzipped.length + ' bytes');
  console.log('  Ratio:        ' + ((gzipped.length / uncompressedSize) * 100).toFixed(1) + '%');
  console.log('\nDone. Run "pio run -t uploadfs" from firmware/ to flash.');
}

build().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
