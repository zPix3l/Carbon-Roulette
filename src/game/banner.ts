import sharp from 'sharp';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fontsDir = resolve(__dirname, '../game/fonts');

// Load & base64-encode fonts once at startup
function loadFont(file: string): string {
  return readFileSync(resolve(fontsDir, file)).toString('base64');
}

const PF_900  = loadFont('PlayfairDisplay-900.woff2');
const PF_700I = loadFont('PlayfairDisplay-700i.woff2');
const DM_400  = loadFont('DMSans-400.woff2');
const DM_700  = loadFont('DMSans-700.woff2');
const SM_700  = loadFont('SpaceMono-700.woff2');

function formatTime(min: number): string {
  const h = Math.round(min / 60);
  if (h <= 0) return `${min} MIN`;
  return h === 1 ? '1 HOUR' : `${h} HOURS`;
}

export async function generateBannerPNG(resolveMinutes: number): Promise<Buffer> {
  const W = 1400, H = 788, cx = W / 2;
  const t = formatTime(resolveMinutes);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
<defs>
  <style>
    @font-face { font-family:'PF'; font-weight:900; src:url(data:font/woff2;base64,${PF_900}) format('woff2'); }
    @font-face { font-family:'PF'; font-weight:700; font-style:italic; src:url(data:font/woff2;base64,${PF_700I}) format('woff2'); }
    @font-face { font-family:'DM'; font-weight:400; src:url(data:font/woff2;base64,${DM_400}) format('woff2'); }
    @font-face { font-family:'DM'; font-weight:700; src:url(data:font/woff2;base64,${DM_700}) format('woff2'); }
    @font-face { font-family:'SM'; font-weight:700; src:url(data:font/woff2;base64,${SM_700}) format('woff2'); }
  </style>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="#0d1a1f"/><stop offset="30%" stop-color="#0f1923"/>
    <stop offset="60%" stop-color="#111b25"/><stop offset="100%" stop-color="#0e161f"/>
  </linearGradient>
  <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="#d4a853"/><stop offset="100%" stop-color="#e8c778"/>
  </linearGradient>
  <linearGradient id="div" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%" stop-color="#fff" stop-opacity="0"/><stop offset="50%" stop-color="#fff" stop-opacity=".15"/>
    <stop offset="100%" stop-color="#fff" stop-opacity="0"/>
  </linearGradient>
  <pattern id="g" width="80" height="80" patternUnits="userSpaceOnUse">
    <path d="M80 0L0 0 0 80" fill="none" stroke="#fff" stroke-opacity=".03"/>
  </pattern>
</defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<rect width="${W}" height="${H}" fill="url(#g)"/>
<ellipse cx="${W * .25}" cy="${H * .5}" rx="420" ry="310" fill="#53d077" opacity=".025"/>
<ellipse cx="${W * .75}" cy="${H * .44}" rx="350" ry="310" fill="#a56f73" opacity=".035"/>
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" fill="none" stroke="#fff" stroke-opacity=".06"/>
<g stroke="#fff" stroke-opacity=".08" fill="none">
  <path d="M24,48V24H48"/><path d="M${W - 48},24H${W - 24}V48"/>
  <path d="M24,${H - 48}V${H - 24}H48"/><path d="M${W - 48},${H - 24}H${W - 24}V${H - 48}"/>
</g>
<g transform="translate(${cx - 110},30) scale(.4)">
  <path fill="#87a790" d="M187,144.6c11-2.1,25.5-.7,41.7,3.5-2.4,9.7-4.2,20.1-5.5,31.1-9.6,7.4-18.5,15-26.2,22.8,2,2.1,4.1,4.2,6.2,6.3,5.7-5.7,12.1-11.4,18.9-17-.5,7.2-.8,14.5-.8,22s0,7.3.2,10.9c3,2.3,6.1,4.6,9.2,6.9-.3-5.8-.5-11.7-.5-17.7,0-10.1.5-19.9,1.4-29.4,5.4-4,11-7.9,16.9-11.7,6.1-3.9,12-7.5,17.8-10.7,8.6,3.9,17.4,8.4,26.1,13.4,7.5,4.3,14.7,8.9,21.5,13.6.7,8.1,1,16.4,1,24.8s-.1,10.4-.4,15.5c3.2-2.4,6.2-4.8,9.2-7.3,0-2.7.1-5.4.1-8.1,0-6.1-.2-12.1-.5-18,5.4,4.1,10.5,8.3,15.2,12.5,2.1-2.2,4.1-4.4,6-6.5-6.7-6-14.1-11.9-22.1-17.6-1.5-15.2-4.1-29.5-7.7-42.3,6.5-1.6,12.6-2.6,18.5-3-.7-2.9-1-5.8-.8-8.8-6.5.5-13.3,1.6-20.3,3.4-.7-2.1-1.4-4.1-2.2-6.1-9.5-24.5-22.8-38-37.2-38s-27.7,13.5-37.2,38c-1.6,4-3,8.2-4.3,12.7-17.6-4.5-33.4-5.9-45.7-3.6-.8.1-1.6.3-2.3.5,1.1,2.7,2.1,5.5,2.9,8.4.3,0,.7-.1,1-.2ZM243.7,164.8c-3.6,2.3-7.1,4.7-10.6,7.1,1.1-7.5,2.5-14.7,4.1-21.5,6.1,1.9,12.4,4.1,18.9,6.7-4.1,2.4-8.2,4.9-12.4,7.6ZM312.7,177c-5.1-3.4-10.4-6.6-15.9-9.8-6.9-4-13.8-7.6-20.7-10.9,10.5-5.4,20.5-9.5,30-12.5,2.9,10.1,5.1,21.4,6.6,33.2ZM243.6,130c8-20.6,18.6-32.3,28.9-32.3s20.9,11.8,28.9,32.3c.7,1.7,1.3,3.5,1.9,5.3-11.8,3.7-24.3,9.2-37.5,16.3-9-3.9-17.9-7.2-26.4-9.8,1.2-4.1,2.6-8.1,4-11.9ZM379.2,273.7c-6.9,12.1-18.5,18.1-34.7,18.1-8.7,0-18.8-1.8-30.2-5.3-1.4,4.7-2.9,9.1-4.5,13.4-9.5,24.5-22.8,38-37.2,38s-27.7-13.5-37.2-38c-1.5-3.8-2.9-7.8-4.1-12-10.6,3.5-20.3,5.3-28.8,5.3s-1.5,0-2.3,0c-14.8-.6-26.3-6.7-33.4-17.8-7.8-12.2-3.6-30.6,11.8-51.8,1.6-2.2,3.4-4.5,5.2-6.8,2,2.1,4.1,4.2,6.3,6.3-1.5,1.9-3,3.8-4.3,5.7-13,17.9-17.2,33.1-11.5,41.8,9.4,14.6,28.5,17.5,54.7,8.7-2.3-9-4-18.7-5.3-28.9,3.3,2.3,6.6,4.4,9.8,6.5,1,6.7,2.3,13.2,3.8,19.4,5.4-2.2,11.1-4.8,17.1-7.9,2.2,1,4.4,2,6.6,2.9.4,1.9-.5,3.9-2.3,4.9-6.6,3.5-13,6.4-19.1,8.8,1.2,4.2,2.6,8.1,4,11.9,8,20.6,18.6,32.3,28.9,32.3s20.9-11.8,28.9-32.3c1.6-4.1,3.1-8.4,4.4-13-5.7-2.1-11.7-4.6-17.9-7.4-1.8-.8-2.8-2.8-2.5-4.7,2.1-1.1,4.2-2.2,6.3-3.3,5.8,2.6,11.2,4.9,16.4,6.9,1.4-6,2.6-12.3,3.6-18.8,3.4-2.2,6.7-4.4,9.9-6.7-1.2,10-2.9,19.5-5.1,28.4,28.1,8.9,46.5,6,54.9-8.7,5.2-9,.2-24-13.6-41.2-1.5-1.8-3-3.6-4.6-5.5,2.1-2.2,4.1-4.4,6-6.6,1.9,2.2,3.8,4.3,5.5,6.5,16.5,20.5,21.6,38.7,14.4,51.2Z"/>
  <circle fill="#87a790" cx="272.6" cy="213.3" r="20"/><circle fill="#87a790" cx="243.6" cy="119.3" r="13.5"/>
  <circle fill="#87a790" cx="204" cy="288.7" r="13.5"/><circle fill="#87a790" cx="372.9" cy="242.5" r="13.5"/>
  <path fill="#53d077" d="M262.7,256.4c-26.1-12.3-56.2-34.3-75.5-57.2-.6-66.7-18.7-103.4-86.1-103.4s-8.2.1-12.6.4c-17,70.3,26.1,108.7,89.4,108.7s1.6,0,2.4,0c21.6,25.1,57.8,52.4,87.7,63.1l-5.4-11.6ZM163.9,142.8l-25.5,31.8c-.9,1.2-2.3,1.8-3.7,1.8s-2.1-.3-3-1.1l-14.2-11.4c-2.1-1.7-2.4-4.7-.7-6.7s4.7-2.4,6.7-.7l10.5,8.4,22.5-28.1c1.7-2.1,4.7-2.4,6.7-.7,2.1,1.7,2.4,4.7.7,6.7Z"/>
  <path fill="#a56f73" d="M373.5,157.3l12.6-12.6-12.6-12.6c-.7-.7-1.1-1.7-1.1-2.7s.4-2,1.1-2.7c.7-.7,1.7-1.1,2.7-1.1s2,.4,2.7,1.1l12.6,12.6,12.6-12.6c.7-.7,1.7-1.1,2.7-1.1s2,.4,2.7,1.1c1.5,1.5,1.5,3.9,0,5.4l-12.6,12.6,12.6,12.6c1.5,1.5,1.5,3.9,0,5.4-.7.7-1.7,1.1-2.7,1.1s-2-.4-2.7-1.1l-12.6-12.6-12.6,12.6c-.7.7-1.7,1.1-2.7,1.1s-2-.4-2.7-1.1c-.7-.7-1.1-1.7-1.1-2.7s.4-2,1.1-2.7ZM430.4,110.4c-1,0-2,0-3,.1-1.9-16.4-17.1-25.1-32.2-25.1-13.5,0-27,7-30.8,21.6-1-.1-2-.2-2.9-.2-19.6,0-31.5,24.2-18.1,39.8-9.5,7.1-10.2,24.1-1.3,31.9-6.1,8.2,1.7,15.7,6.7,15.7s3.8-1.4,3.5-4.7c-.7-2.1-6.2-5.2-1.1-7.1,1.7-.6,2.8-2.2,2.9-4.1,0-1.8-1-3.5-2.7-4.2-9.8-4.7-9.1-18.8,1-22.6,11.7-7.4-12.4-8.9-4.2-27.2,2-4.9,7.6-8.8,13.5-8.8s3.3.3,4.9.9c.5.1,1,.2,1.4.2,8.5,0,.2-21.7,27.4-22.6,31.1,1.8,18,25.7,28,25.7s.4,0,.6,0c2.1-.4,4.1-.6,6-.6,27.5,0,31.1,42.5-1.4,42.5s-.3,0-.4,0c-11.7.8,4.3,14.7-11.6,23.7-2.8,1.7-6,2.6-9.1,2.6-4.7,0-9.2-1.8-12-5.2-.8-1-2.1-1.5-3.4-1.5-.2,0-.3,0-.5,0-1.4.2-2.7,1-3.4,2.3-3.1,5.7-9.4,7.1-14.8,7.1-.3,0-.7,0-1,0-4.6,0-7.1-1.4-9.4-1.4-1.5,0-2.9.6-4.8,2.7-14.5,22.7-45.5,47.9-77.4,64.8l-4.3,11.5c.5.2,1,.3,1.6.3s1.5-.2,2.2-.5c35.5-17.8,68.8-43.7,85.1-69.3,2.2.5,4.7.8,7.3.8,7.6,0,15.9-2.2,20.1-7.2,4.1,3.2,9,4.6,13.9,4.6,14.1,0,28.7-11.6,26.4-26.5,39.4-3.9,34.3-59.9-2.7-59.9Z"/>
</g>
<text x="${cx}" y="370" text-anchor="middle" font-family="PF,Georgia,serif" font-size="86" font-weight="900" letter-spacing="-2">
  <tspan fill="#e8e0d4">Carbon </tspan><tspan fill="url(#gold)" font-style="italic" font-weight="700">Roulette</tspan>
</text>
<text x="${cx}" y="416" text-anchor="middle" font-family="SM,monospace" font-size="18" font-weight="700" fill="#c8c8c8" fill-opacity=".35" letter-spacing="8">DUE DILIGENCE GAME</text>
<rect x="${cx - 50}" y="446" width="100" height="1" fill="url(#div)"/>
<text x="${cx}" y="500" text-anchor="middle" font-family="DM,sans-serif" font-size="26" fill="#dcdcdc" fill-opacity=".65">A carbon credit project drops. <tspan fill-opacity=".85" font-weight="500">You decide:</tspan></text>
<text x="${cx}" y="580" text-anchor="middle" font-size="42" font-weight="700">
  <tspan font-family="DM,sans-serif" fill="#53d077">legit</tspan>
  <tspan font-family="PF,Georgia,serif" font-size="30" font-weight="700" font-style="italic" fill="#b4b4b4" fill-opacity=".3" dx="14">or</tspan>
  <tspan font-family="DM,sans-serif" fill="#a56f73" dx="14">scam</tspan>
  <tspan fill="#b4b4b4" fill-opacity=".2" font-weight="400" dx="4">?</tspan>
</text>
<line x1="${cx - 62}" x2="${cx + 58}" y1="590" y2="590" stroke="#53d077" stroke-opacity=".4" stroke-width="2.5"/>
<line x1="${cx + 100}" x2="${cx + 200}" y1="590" y2="590" stroke="#a56f73" stroke-opacity=".4" stroke-width="2.5"/>
<rect x="${cx - 190}" y="${H - 80}" width="380" height="52" rx="26" fill="#fff" fill-opacity=".03" stroke="#fff" stroke-opacity=".06"/>
<circle cx="${cx - 148}" cy="${H - 54}" r="5.5" fill="#53d077"/>
<text x="${cx + 8}" y="${H - 46}" text-anchor="middle" font-family="SM,monospace" font-size="16" font-weight="700" fill="#c8c8c8" fill-opacity=".5" letter-spacing="3">YOU HAVE <tspan fill="#fff" fill-opacity=".85">${t}</tspan></text>
</svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}
