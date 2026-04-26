import type { Response } from 'express';
import * as crm from '../integrations/crm';

export interface Notification {
  id:        string;
  type:      'alert' | 'suggestion' | 'reminder' | 'urgent';
  title:     string;
  message:   string;
  urgency:   'low' | 'medium' | 'high';
  timestamp: string;
}

interface SSEClient { id: string; res: Response; }

const clients: SSEClient[] = [];

export function addSSEClient(res: Response): string {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  clients.push({ id, res });
  return id;
}

export function removeSSEClient(id: string): void {
  const idx = clients.findIndex(c => c.id === id);
  if (idx !== -1) clients.splice(idx, 1);
}

function broadcast(n: Notification): void {
  const chunk = `data: ${JSON.stringify(n)}\n\n`;
  for (const c of [...clients]) {
    try { c.res.write(chunk); } catch { removeSSEClient(c.id); }
  }
}

// Push externo (alarmes, etc) usa o mesmo canal SSE.
export function broadcastNotification(n: Notification): void {
  broadcast(n);
}

async function runCheck(): Promise<void> {
  if (clients.length === 0) return;

  const now         = new Date();
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

  const [leadsRes, campanhasRes] = await Promise.allSettled([
    crm.listarLeads({ limite: 200 }),
    crm.listarCampanhas(),
  ]);

  if (leadsRes.status === 'fulfilled') {
    const semResposta = leadsRes.value.filter(
      l => l.score === 'frio' && new Date(l.created_at) < twoHoursAgo,
    );
    if (semResposta.length > 0) {
      broadcast({
        id:        `leads-${Date.now()}`,
        type:      'alert',
        title:     'Leads sem resposta',
        message:   `${semResposta.length} lead(s) novo(s) aguardando há mais de 2 horas.`,
        urgency:   'medium',
        timestamp: now.toISOString(),
      });
    }
  }

  if (campanhasRes.status === 'fulfilled') {
    const baixaResposta = campanhasRes.value.filter(
      c => c.status === 'ativa' && c.enviados > 10 && (c.respondidos / c.enviados) < 0.1,
    );
    if (baixaResposta.length > 0) {
      broadcast({
        id:        `camp-${Date.now()}`,
        type:      'suggestion',
        title:     'Campanhas com baixa resposta',
        message:   `${baixaResposta.length} campanha(s) com taxa abaixo de 10%.`,
        urgency:   'low',
        timestamp: now.toISOString(),
      });
    }
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startProactiveNotifications(): void {
  if (timer) return;
  timer = setInterval(() => { void runCheck(); }, 30 * 60 * 1000);
}
