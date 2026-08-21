import { http } from './client';
import { getDeviceId } from '../utils/device';
import type { UserProfile } from '../types';

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  expires_in: string;
  user: UserProfile;
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  const device_id = await getDeviceId();
  const res = await http.post<LoginResponse>('/auth/login', { email, password, device_id });
  return res.data;
}

export async function fetchMe(): Promise<UserProfile> {
  const res = await http.get<{ user: UserProfile }>('/auth/me');
  return res.data.user;
}
