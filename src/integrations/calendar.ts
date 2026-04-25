import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';

function makeClient(): OAuth2Client {
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI ?? 'http://localhost:3000/auth/google/callback',
  );
  if (process.env.GOOGLE_REFRESH_TOKEN) {
    client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  }
  return client;
}

export function getAuthUrl(): string {
  return makeClient().generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar'],
    prompt: 'consent',
  });
}

export async function exchangeCode(code: string): Promise<string> {
  const { tokens } = await makeClient().getToken(code);
  return tokens.refresh_token ?? '';
}

export interface CalendarEvent {
  id:     string;
  titulo: string;
  inicio: string;
  fim:    string;
  link:   string;
}

export async function criarEvento(params: {
  titulo:      string;
  data:        string;
  hora_inicio: string;
  hora_fim:    string;
  descricao?:  string;
}): Promise<CalendarEvent> {
  const auth = makeClient();
  const cal  = google.calendar({ version: 'v3', auth });

  const ev = await cal.events.insert({
    calendarId: 'primary',
    requestBody: {
      summary:     params.titulo,
      description: params.descricao,
      start: { dateTime: `${params.data}T${params.hora_inicio}:00`, timeZone: 'America/Fortaleza' },
      end:   { dateTime: `${params.data}T${params.hora_fim}:00`,    timeZone: 'America/Fortaleza' },
    },
  });

  return {
    id:     ev.data.id          ?? '',
    titulo: ev.data.summary     ?? '',
    inicio: ev.data.start?.dateTime ?? '',
    fim:    ev.data.end?.dateTime   ?? '',
    link:   ev.data.htmlLink        ?? '',
  };
}

async function listRange(timeMin: string, timeMax: string): Promise<CalendarEvent[]> {
  const auth = makeClient();
  const cal  = google.calendar({ version: 'v3', auth });

  const res = await cal.events.list({
    calendarId:   'primary',
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy:      'startTime',
    maxResults:   50,
  });

  return (res.data.items ?? []).map(e => ({
    id:     e.id                      ?? '',
    titulo: e.summary                 ?? '',
    inicio: e.start?.dateTime ?? e.start?.date ?? '',
    fim:    e.end?.dateTime   ?? e.end?.date   ?? '',
    link:   e.htmlLink                ?? '',
  }));
}

export async function listarEventosDia(data?: string): Promise<CalendarEvent[]> {
  const base = data ? new Date(data) : new Date();
  const min  = new Date(base); min.setHours(0,  0,  0,   0);
  const max  = new Date(base); max.setHours(23, 59, 59, 999);
  return listRange(min.toISOString(), max.toISOString());
}

export async function listarEventosSemana(): Promise<CalendarEvent[]> {
  const now = new Date();
  const end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  return listRange(now.toISOString(), end.toISOString());
}

export async function cancelarEvento(eventId: string): Promise<void> {
  const auth = makeClient();
  const cal  = google.calendar({ version: 'v3', auth });
  await cal.events.delete({ calendarId: 'primary', eventId });
}
