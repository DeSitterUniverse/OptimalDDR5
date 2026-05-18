import type { ConfigData, Evaluation, MemoryProfile } from "./types";

export async function fetchConfig(): Promise<ConfigData> {
  const res = await fetch("/api/config");
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function evaluateProfile(profile: MemoryProfile): Promise<Evaluation> {
  const res = await fetch("/api/evaluate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(profile)
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function importHwinfo(file: File, profile: MemoryProfile): Promise<{ profile: MemoryProfile; evaluation: Evaluation }> {
  const form = new FormData();
  form.append("file", file);
  form.append("profile_json", JSON.stringify(profile));
  const res = await fetch("/api/import/hwinfo", { method: "POST", body: form });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
