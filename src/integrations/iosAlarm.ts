// iOS Alarm via ntfy.sh + Atalhos (Shortcuts) — v1.24.0
// Permite que ZAYRA dispare alarmes nativos no iPhone do Chefe.
// Fluxo: ZAYRA → POST ntfy.sh → app ntfy do iPhone recebe → Atalho "ZAYRA-Alarme"
// roda e cria o alarme nativo via ação "Criar alarme".

import axios from 'axios';

const NTFY_TOPIC = process.env.IOS_NTFY_TOPIC;
const NTFY_BASE  = process.env.IOS_NTFY_BASE || 'https://ntfy.sh';

export interface AlarmePayload {
  titulo:        string;
  /** ISO 8601 com timezone, ex: 2026-04-27T08:30:00-03:00 (Fortaleza/BRT) */
  datetime_iso:  string;
  notas?:        string;
}

export async function alarmeIosCriar(p: AlarmePayload) {
  if (!NTFY_TOPIC) {
    throw new Error('IOS_NTFY_TOPIC não configurado no .env (defina um tópico secreto e o CEO assina pelo app ntfy).');
  }

  const url = `${NTFY_BASE}/${NTFY_TOPIC}`;
  const body = JSON.stringify({
    action:   'create_alarm',
    titulo:   p.titulo,
    datetime: p.datetime_iso,
    notas:    p.notas || '',
  });

  await axios.post(url, body, {
    headers: {
      'Title':        `ZAYRA — Alarme: ${p.titulo}`,
      'Priority':     'high',
      'Tags':         'alarm_clock',
      'Click':        `shortcuts://run-shortcut?name=ZAYRA-Alarme&input=text&text=${encodeURIComponent(body)}`,
      'Content-Type': 'application/json',
    },
    timeout: 8000,
  });

  return { ok: true, scheduled_for: p.datetime_iso, channel: 'ntfy', titulo: p.titulo };
}
