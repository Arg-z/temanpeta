// Parser user-agent ringan tanpa dependensi untuk kolom audit login
// (perangkat/OS/browser). Bukan deteksi kapabilitas — UA mentah tetap
// disimpan di login_events sehingga analisis lanjutan tidak kehilangan data.

// FBDV/<identifier> (app Facebook) = ID perangkat Apple yang eksak, jauh
// lebih spesifik daripada sekadar "iPhone". Peta model umum; yang tak dikenal
// tetap ditampilkan sebagai "iPhone (<identifier>)".
const APPLE_DEVICES = {
  'iphone8,1': 'iPhone 6s',
  'iphone8,2': 'iPhone 6s Plus',
  'iphone8,4': 'iPhone SE (gen 1)',
  'iphone9,1': 'iPhone 7',
  'iphone9,3': 'iPhone 7',
  'iphone9,2': 'iPhone 7 Plus',
  'iphone9,4': 'iPhone 7 Plus',
  'iphone10,1': 'iPhone 8',
  'iphone10,4': 'iPhone 8',
  'iphone10,2': 'iPhone 8 Plus',
  'iphone10,5': 'iPhone 8 Plus',
  'iphone10,3': 'iPhone X',
  'iphone10,6': 'iPhone X',
  'iphone11,2': 'iPhone XS',
  'iphone11,4': 'iPhone XS Max',
  'iphone11,6': 'iPhone XS Max',
  'iphone11,8': 'iPhone XR',
  'iphone12,1': 'iPhone 11',
  'iphone12,3': 'iPhone 11 Pro',
  'iphone12,5': 'iPhone 11 Pro Max',
  'iphone12,8': 'iPhone SE (gen 2)',
  'iphone13,1': 'iPhone 12 mini',
  'iphone13,2': 'iPhone 12',
  'iphone13,3': 'iPhone 12 Pro',
  'iphone13,4': 'iPhone 12 Pro Max',
  'iphone14,2': 'iPhone 13 Pro',
  'iphone14,3': 'iPhone 13 Pro Max',
  'iphone14,4': 'iPhone 13 mini',
  'iphone14,5': 'iPhone 13',
  'iphone14,6': 'iPhone SE (gen 3)',
  'iphone14,7': 'iPhone 14',
  'iphone14,8': 'iPhone 14 Plus',
  'iphone15,2': 'iPhone 14 Pro',
  'iphone15,3': 'iPhone 14 Pro Max',
  'iphone15,4': 'iPhone 15',
  'iphone15,5': 'iPhone 15 Plus',
  'iphone16,1': 'iPhone 15 Pro',
  'iphone16,2': 'iPhone 15 Pro Max',
  'iphone17,1': 'iPhone 16 Pro',
  'iphone17,2': 'iPhone 16 Pro Max',
  'iphone17,3': 'iPhone 16',
  'iphone17,4': 'iPhone 16 Plus',
  'iphone17,5': 'iPhone 16e',
};

function appleDevice(ua) {
  const id = ua.match(/FBDV\/([A-Za-z]+[0-9,]+)/)?.[1];
  if (id) {
    const key = id.toLowerCase();
    if (APPLE_DEVICES[key]) return APPLE_DEVICES[key];
    return `${key.startsWith('ipad') ? 'iPad' : 'iPhone'} (${id})`;
  }
  if (/iPad/.test(ua)) return 'iPad';
  if (/iPod/.test(ua)) return 'iPod touch';
  if (/iPhone/.test(ua)) return 'iPhone';
  return null;
}

// "...; Android 14; SM-S918B Build/...)" atau "...; Android 10; K)" → model.
function androidDevice(ua) {
  const model = ua.match(/Android [\d.]+; ([^;)]+?)(?: Build\/|\))/)?.[1]?.trim();
  if (!model || model.toLowerCase() === 'wv') return null; // wv = WebView, bukan model
  return model;
}

function osName(ua) {
  // FBSV = versi OS menurut aplikasi Facebook, lebih presisi daripada token
  // "OS 18_7" dari WebKit yang dibulatkan.
  const fbsv = ua.match(/FBSV\/([\d.]+)/)?.[1];
  if (/iPhone|iPad|iPod/.test(ua) || fbsv) return `iOS ${fbsv ?? (ua.match(/OS (\d+_\d+(?:_\d+)?)/)?.[1] ?? '').replace(/_/g, '.')}`;
  const android = ua.match(/Android ([\d.]+)/);
  if (android) return `Android ${android[1]}`;
  const nt = ua.match(/Windows NT ([\d.]+)/)?.[1];
  if (nt) {
    return { '10.0': 'Windows 10/11', '6.3': 'Windows 8.1', '6.2': 'Windows 8', '6.1': 'Windows 7' }[nt] ?? 'Windows';
  }
  const mac = ua.match(/Mac OS X ([\d_]+)/)?.[1];
  if (mac) return `macOS ${mac.replace(/_/g, '.')}`;
  if (/CrOS/.test(ua)) return 'ChromeOS';
  if (/Linux/.test(ua)) return 'Linux';
  return null;
}

function browserName(ua) {
  if (/bot|crawl|spider|slurp/i.test(ua)) return 'Bot/crawler';
  // Browser in-app dulu — UA-nya selalu memuat token Chrome/Safari juga.
  const fbav = ua.match(/FBAV\/([\d.]+)/)?.[1];
  if (/FBAN\/FBIOS|FBSN\/iOS|FBMD\/iPhone|FBMD\/iPad/.test(ua)) {
    return `Facebook iOS${fbav ? ` ${fbav}` : ''} (in-app)`;
  }
  if (/FB_IAB|FB4A/.test(ua)) return `Facebook Android${fbav ? ` ${fbav}` : ''} (in-app)`;
  if (/Orca-(Android|iOS)|MESSENGER/.test(ua)) return 'Messenger (in-app)';
  const ig = ua.match(/Instagram\/([\d.]+)/)?.[1];
  if (ig || /FBAN\/[^;]*Instagram|IG /i.test(ua)) return `Instagram${ig ? ` ${ig}` : ''} (in-app)`;
  if (/TikTok/.test(ua)) return 'TikTok (in-app)';
  if (/Snapchat/.test(ua)) return 'Snapchat (in-app)';
  if (/WhatsApp/.test(ua)) return 'WhatsApp (in-app)';
  if (/LINE\//.test(ua)) return 'LINE (in-app)';
  const major = (v) => (v ? v.split('.')[0] : null);
  const samsung = major(ua.match(/SamsungBrowser\/([\d.]+)/)?.[1]);
  if (samsung) return `Samsung Internet ${samsung}`;
  const edge = major(ua.match(/(?:EdgiOS|EdgA|Edg)\/([\d.]+)/)?.[1]);
  if (edge) return `Edge ${edge}`;
  const opera = major(ua.match(/(?:OPiOS|OPR)\/([\d.]+)/)?.[1]);
  if (opera) return `Opera ${opera}`;
  const firefox = major(ua.match(/(?:FxiOS|Firefox)\/([\d.]+)/)?.[1]);
  if (firefox) return `Firefox ${firefox}`;
  const crios = major(ua.match(/CriOS\/([\d.]+)/)?.[1]);
  if (crios) return `Chrome ${crios}`;
  const chrome = major(ua.match(/Chrome\/([\d.]+)/)?.[1]);
  if (chrome) return /[; ]wv\)/.test(ua) ? `WebView Android ${chrome}` : `Chrome ${chrome}`;
  if (/Safari/.test(ua)) {
    const ver = major(ua.match(/Version\/([\d.]+)/)?.[1]);
    return `Safari${ver ? ` ${ver}` : ''}`;
  }
  return 'Browser tidak dikenal';
}

export function parseUserAgent(raw) {
  const ua = String(raw ?? '').slice(0, 600);
  if (!ua) return { device: null, os: null, browser: null };
  const apple = appleDevice(ua);
  const android = apple ? null : androidDevice(ua);
  // Label desktop hanya untuk UA desktop — UA WebView Android memuat token
  // "Linux" dan tidak boleh terbaca sebagai PC.
  const desktop = /Android|iPhone|iPad|iPod/.test(ua)
    ? null
    : (/Windows/.test(ua) ? 'PC Windows' : null) ??
      (/Macintosh/.test(ua) ? 'Mac' : null) ??
      (/CrOS/.test(ua) ? 'Chromebook' : null) ??
      (/Linux/.test(ua) ? 'PC Linux' : null);
  return { device: apple ?? android ?? desktop, os: osName(ua), browser: browserName(ua) };
}
