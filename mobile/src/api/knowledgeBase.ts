import { http } from './client';
import { API_BASE_URL } from '../config';

/** Fetches the raw text of a text/markdown Knowledge Base file for offline caching. Only ever
 * called once per entry while online - after that, PanduanDetailScreen reads the cached copy from
 * SQLite (kbRepo.cached_text), so the guide is readable fully offline afterwards. */
export async function fetchKbFileText(id: number): Promise<string> {
  const res = await http.get<string>(`/knowledge-base/${id}/file`, { responseType: 'text', transformResponse: (d) => d });
  return typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
}

export function kbFileFullUrl(downloadUrl: string): string {
  if (downloadUrl.startsWith('http')) return downloadUrl;
  const apiOrigin = API_BASE_URL.replace(/\/api\/?$/, '');
  return `${apiOrigin}${downloadUrl}`;
}
