// PillFlow Service Worker
// Gerencia notificações em background e cache offline

const CACHE = 'pillflow-v1';
const ASSETS = ['./PillFlow.html', './manifest.json', './icons/icon-192x192.png', './icon-192.png'];

// ── INSTALL: cache dos assets ──
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

// ── ACTIVATE ──
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── FETCH: serve do cache quando offline ──
self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request)).catch(() => caches.match('./PillFlow.html'))
  );
});

// ── PUSH: recebe notificação push (futuramente via Supabase) ──
self.addEventListener('push', e => {
  const data = e.data?.json() || {};
  e.waitUntil(
    self.registration.showNotification(data.title || 'PillFlow', {
      body: data.body || 'Hora do seu lembrete!',
      icon: data.icon || './icon-192.png',
      badge: './icon-192.png',
      tag: data.tag || 'pillflow',
      renotify: true,
      requireInteraction: true,
      vibrate: [200, 100, 200],
      data: { url: data.url || './PillFlow.html', reminderId: data.reminderId },
      actions: [
        { action: 'confirm', title: '✓ Tomei' },
        { action: 'snooze',  title: '⏰ 15min' },
      ]
    })
  );
});

// ── NOTIFICATION CLICK ──
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const action = e.action;
  const data = e.notification.data || {};

  if (action === 'snooze') {
    // agenda nova notificação em 15 min
    e.waitUntil(
      new Promise(resolve => {
        setTimeout(() => {
          self.registration.showNotification('PillFlow — Lembrete adiado', {
            body: e.notification.body,
            icon: e.notification.icon,
            tag: 'pillflow-snooze',
            requireInteraction: true,
            vibrate: [200, 100, 200],
          });
          resolve();
        }, 15 * 60 * 1000);
        resolve(); // resolve imediatamente para não bloquear
      })
    );
    return;
  }

  // confirm ou clique direto: abre o app
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      // se já tem janela aberta, foca
      for (const client of list) {
        if (client.url.includes('PillFlow') && 'focus' in client) {
          if (action === 'confirm' && data.reminderId) {
            client.postMessage({ type: 'CONFIRM_REMINDER', id: data.reminderId });
          }
          return client.focus();
        }
      }
      // senão abre
      return clients.openWindow(data.url || './PillFlow.html');
    })
  );
});

// ── MESSAGE: recebe mensagens do app principal ──
self.addEventListener('message', e => {
  if (e.data?.type === 'SCHEDULE_NOTIFICATIONS') {
    // guarda os lembretes para checar
    scheduleCheck(e.data.reminders);
  }
  if (e.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ── BACKGROUND SYNC: verifica lembretes periodicamente ──
let checkInterval = null;

function scheduleCheck(reminders) {
  if (!reminders || !reminders.length) return;

  // salva no cache para persistir
  caches.open(CACHE).then(c => {
    c.put('_reminders', new Response(JSON.stringify(reminders)));
  });

  // checa a cada 30 segundos se algum está na hora
  if (checkInterval) clearInterval(checkInterval);
  checkInterval = setInterval(() => checkDue(reminders), 30000);
  checkDue(reminders); // checa imediatamente
}

async function checkDue(reminders) {
  const now = Date.now();
  for (const r of reminders) {
    const nextDose = new Date(r.next_dose || r.nextDose).getTime();
    const diff = nextDose - now;
    // se está na hora (dentro de 1 minuto)
    if (diff <= 0 && diff > -60000) {
      const tag = 'pill-' + r.id;
      // evita notificar duas vezes
      const existing = await self.registration.getNotifications({ tag });
      if (existing.length > 0) continue;

      await self.registration.showNotification('💊 ' + r.name + (r.dosage ? ' — ' + r.dosage : ''), {
        body: r.note ? r.note : 'Hora de tomar ' + r.name + '!',
        tag,
        renotify: false,
        requireInteraction: true,
        vibrate: [200, 100, 200, 100, 200],
        data: { reminderId: r.id, url: './PillFlow.html' },
        actions: [
          { action: 'confirm', title: '✓ Tomei' },
          { action: 'snooze',  title: '⏰ +15min' },
        ]
      });
    }
  }
}
