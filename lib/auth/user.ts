import type { User } from "@supabase/supabase-js";

export type StoredAppLanguage = "en" | "es";

export function getUserDisplayName(user: User): string {
  const metadata = user.user_metadata ?? {};
  const name =
    (typeof metadata.full_name === "string" && metadata.full_name.trim()) ||
    (typeof metadata.name === "string" && metadata.name.trim()) ||
    "";

  return name;
}

export function getUserLanguagePreference(user: User): StoredAppLanguage | null {
  const value = user.user_metadata?.language_preference;
  return value === "es" ? "es" : value === "en" ? "en" : null;
}

export function formatAccountCreatedDate(createdAt: string | undefined): string {
  if (!createdAt) return "—";

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(createdAt));
}

export function getLanguageLabel(language: StoredAppLanguage): string {
  return language === "es" ? "Español" : "English";
}
