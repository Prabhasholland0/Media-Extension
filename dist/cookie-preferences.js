const key = 'nlag_cookie_preferences';
function readChoice() {
  try {
    const raw = document.cookie.split('; ').find(item => item.startsWith(key + '='));
    const value = raw && JSON.parse(decodeURIComponent(raw.slice(key.length + 1)));
    return value?.version === 1 && ['accepted', 'essential'].includes(value.choice) ? value : null;
  } catch { return null; }
}
const region = document.createElement('section');
region.className = 'cookie-banner';
region.setAttribute('aria-label', 'Cookie preferences');
region.innerHTML = `<div><h2>Cookies & your privacy</h2><p>We use essential browser storage to keep you signed in and support password recovery. This cookie remembers your preference. We currently use no advertising or analytics cookies.</p></div><div class="cookie-actions"><button type="button" data-choice="accepted">Accept</button><button type="button" data-choice="essential">Essential only</button><button type="button" data-settings>Settings</button></div><p class="cookie-feedback" role="status"></p>`;
const settings = document.createElement('dialog');
settings.className = 'cookie-dialog';
settings.setAttribute('aria-labelledby', 'cookie-title');
settings.innerHTML = `<form method="dialog"><header><h2 id="cookie-title">Cookie preferences</h2><button aria-label="Close cookie settings" value="close">×</button></header><p>You control your cookie preference. Essential storage supports the app’s account features.</p><section><h3>Essential storage <span>Always active</span></h3><p>Login sessions use local storage. Password recovery uses session storage. Your cookie preference is stored for 180 days.</p></section><section><h3>Optional cookies <span>None in use</span></h3><p>There are currently no analytics or advertising cookies. Accept and Essential only therefore enable the same essential features.</p></section><div class="cookie-actions"><button type="button" data-choice="accepted">Accept</button><button type="button" data-choice="essential">Essential only</button></div><p class="cookie-feedback" role="status"></p></form>`;
const reopen = document.createElement('button');
reopen.type = 'button';
reopen.className = 'cookie-reopen';
reopen.textContent = 'Cookie settings';
reopen.setAttribute('aria-haspopup', 'dialog');
function openSettings() { if (!settings.open) settings.showModal(); }
reopen.onclick = openSettings;
region.querySelector('[data-settings]').onclick = openSettings;
for (const root of [region, settings]) {
  root.querySelectorAll('[data-choice]').forEach(button => button.onclick = () => {
    try {
      const value = {version: 1, choice: button.dataset.choice};
      document.cookie = `${key}=${encodeURIComponent(JSON.stringify(value))}; Max-Age=15552000; Path=/; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
      if (!readChoice()) throw new Error('Storage unavailable');
      region.hidden = true;
      reopen.hidden = false;
      settings.close();
      reopen.focus({preventScroll: true});
    } catch {
      root.querySelector('.cookie-feedback').textContent = 'Your browser could not save this preference. You can still use the app with essential storage only.';
    }
  });
}
region.hidden = Boolean(readChoice());
reopen.hidden = !region.hidden;
document.body.append(region, settings, reopen);
