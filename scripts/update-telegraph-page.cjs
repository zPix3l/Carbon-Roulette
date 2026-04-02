const https = require("https");

const TOKEN = "REDACTED_TOKEN";
const PAGE_PATH = "Carbon-Roulette--How-to-Play-04-02";

const IMAGES = {
  drop: "https://files.catbox.moe/s7ymvt.jpg",
  casefile: "https://files.catbox.moe/eykipk.jpg",
  verdict: "https://files.catbox.moe/k6u437.jpg"
};

const content = [
  {"tag": "h4", "children": ["What is Carbon Roulette?"]},
  {"tag": "p", "children": ["A daily game in your Telegram group. Each day, a carbon credit project drops. You decide: is it legit or a scam?"]},
  {"tag": "p", "children": ["Get it right → earn points. Get it wrong → lose points. Simple."]},

  {"tag": "hr"},

  {"tag": "h4", "children": ["How a round works"]},
  {"tag": "p", "children": ["1. A new project drops in the group chat"]},
  {"tag": "figure", "children": [{"tag": "img", "attrs": {"src": IMAGES.drop}}, {"tag": "figcaption", "children": ["The daily drop in your group"]}]},

  {"tag": "p", "children": ["2. Click INVESTIGATE → you get the full case file in DM"]},
  {"tag": "figure", "children": [{"tag": "img", "attrs": {"src": IMAGES.casefile}}, {"tag": "figcaption", "children": ["Your private case file with all the details"]}]},

  {"tag": "p", "children": ["3. Read it. Spot red flags. Then choose: BUY or PASS"]},
  {"tag": "p", "children": ["4. After 1 hour, the verdict drops"]},
  {"tag": "figure", "children": [{"tag": "img", "attrs": {"src": IMAGES.verdict}}, {"tag": "figcaption", "children": ["The verdict — who got it right?"]}]},

  {"tag": "hr"},

  {"tag": "h4", "children": ["Scoring"]},
  {"tag": "p", "children": ["You start with 1,000 points. Each round you bet 50, 100, 250 or go ALL IN."]},
  {"tag": "p", "children": ["✅ BUY a legit project → +100% of your bet"]},
  {"tag": "p", "children": ["🚫 BUY a scam → −100% of your bet"]},
  {"tag": "p", "children": ["🔍 PASS on a scam → +50% of your bet"]},
  {"tag": "p", "children": ["😴 PASS on a legit one → −25% of your bet"]},
  {"tag": "p", "children": ["Win 3 in a row → 1.5× multiplier. Win 5 → 2×"]},

  {"tag": "hr"},

  {"tag": "h4", "children": ["Red flags to watch for"]},
  {"tag": "p", "children": ["Wrong biome for the country (mangroves in Austria? nope)"]},
  {"tag": "p", "children": ["Price way outside normal range"]},
  {"tag": "p", "children": ["Yield numbers that are physically impossible"]},
  {"tag": "p", "children": ["Mismatched standard + methodology combos"]},
  {"tag": "p", "children": ["Shady auditors or missing certifications"]},

  {"tag": "hr"},

  {"tag": "h4", "children": ["Commands"]},
  {"tag": "p", "children": ["/play — join the game"]},
  {"tag": "p", "children": ["/portfolio — check your points and stats"]},
  {"tag": "p", "children": ["/leaderboard — see the rankings"]},
  {"tag": "p", "children": ["/bailout — get 500 pts if you're broke (once per week)"]},

  {"tag": "hr"},

  {"tag": "p", "children": ["30 rounds. 30 projects. good luck."]},
  {"tag": "p", "children": [{"tag": "em", "children": ["Built for BigWater Carbon Club"]}]}
];

const body = JSON.stringify({
  access_token: TOKEN,
  path: PAGE_PATH,
  title: "Carbon Roulette — How to Play",
  content: content,
  return_content: false
});

const req = https.request({
  hostname: "api.telegra.ph",
  path: "/editPage",
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body)
  }
}, res => {
  let d = "";
  res.on("data", c => d += c);
  res.on("end", () => {
    const parsed = JSON.parse(d);
    if (parsed.ok) {
      console.log("✅ Page updated: https://telegra.ph/" + PAGE_PATH);
    } else {
      console.error("❌ Error:", parsed.error);
    }
  });
});
req.on("error", e => console.error("Error:", e));
req.write(body);
req.end();
