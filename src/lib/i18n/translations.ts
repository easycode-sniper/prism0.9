// The UI's translations.
//
// THIS FILE USED TO BE CHROME ONLY. Its original comment said so: nav,
// page headers and common actions were translated and "deep content —
// notification message text, error strings, form field values — stays
// English". The result is the one the owner reported on 2026-09-03: switch
// to French and the menu changes while the screen underneath does not.
// French is now expected to be COMPLETE. scripts/check-i18n.mts fails the
// build if any key reaching t() has no French, which is the only way to
// keep it complete — a missing translation silently renders English
// instead of breaking, so nothing else would ever notice.
//
// ARABIC IS DELIBERATELY LEFT AS IT WAS, at the owner's request the same
// day: it keeps the original chrome-level keys below and falls back to
// English for everything else, exactly as before. He also does not want
// the RTL flip pursued. So do not "finish" Arabic without asking.
//
// TWO KEY SHAPES, and the reason is Arabic. The chrome keys are dotted
// ("nav.dashboard") because the Arabic dictionary is keyed that way and
// renaming them would silently drop every Arabic string to English.
// Everything added since is keyed BY ITS ENGLISH TEXT, which for a
// dictionary this size is the safer convention: there is no key to invent
// and none to mistype, and when a key is missing the reader sees the
// English sentence rather than "dashboard.fuel.caption". Add new strings
// in the English-text style.

export type Language = "en" | "fr" | "ar";

/**
 * Keys whose French is legitimately identical to the English.
 *
 * check-i18n.mts treats fr === en as an untranslated string, because that
 * is overwhelmingly what it means. These are the real exceptions — words
 * French and English spell the same way — and listing them explicitly is
 * what keeps that check strict enough to be worth running.
 */
/**
 * Keys that never appear as a literal inside t(), because the value is
 * resolved at runtime — t(error) on a message Supabase produced, for one.
 *
 * check-i18n.mts reports a key it cannot find at any call site as "safe to
 * delete". For these that advice would be exactly wrong, so they are
 * declared here instead.
 */
export const RUNTIME_KEYS = new Set<string>([
  "Invalid login credentials",
  "Email not confirmed",
  "User not found",
  "Email rate limit exceeded",
]);

export const SAME_IN_FRENCH = new Set<string>([
  "nav.admin",
  "admin.title",
  "notifications.title",
  "Destination",
]);

export const translations: Record<Language, Record<string, string>> = {
  en: {
    "brand.title": "Fleet Route Monitor",
    "brand.subtitle": "OMD Transport · Amouda Line",
    "nav.dashboard": "Dashboard",
    "nav.dispatch": "Dispatch",
    "nav.monitoring": "Monitoring",
    "nav.history": "History",
    "nav.reports": "Reports",
    "nav.drivers": "Drivers",
    "nav.carburant": "Fuel",
    "nav.notifications": "Notifications",
    "nav.admin": "Admin",
    "common.signOut": "Sign Out",
    "common.language": "Language",
    "dashboard.title": "Dashboard",
    "dashboard.subtitle": "Fleet status overview",
    "dispatch.title": "Dispatch",
    "dispatch.subtitle": "Assign trucks to destinations and check route compliance.",
    "monitoring.title": "Monitoring",
    "history.title": "History",
    "reports.title": "Rapport Parc",
    "reports.subtitle": "Trucks that entered PARC OMD.",
    "notifications.title": "Notifications",
    "admin.title": "Admin",

    // ── Sign in ──
    "OMD Fleet Operations": "OMD Fleet Operations",
    "Email": "Email",
    "Password": "Password",
    "Hide password": "Hide password",
    "Show password": "Show password",
    "Signing in…": "Signing in…",
    "Sign in": "Sign in",
    "No account?": "No account?",
    "Request an invite": "Request an invite",
    "Please enter both email and password.": "Please enter both email and password.",
    "Please enter a valid email address.": "Please enter a valid email address.",
    "Invalid login credentials": "Invalid login credentials",
    "Email not confirmed": "Email not confirmed",
    "User not found": "User not found",
    "Email rate limit exceeded": "Email rate limit exceeded",

    // ── App shell ──
    "go to dashboard": "go to dashboard",
    "Active:": "Active:",
    "Live tracking active": "Live tracking active",
    "Live tracking paused": "Live tracking paused",
    "Live tracking error": "Live tracking error",
    "Operational status": "Operational status",
    "Active runs": "Active runs",
    "Off route": "Off route",
    "Last update": "Last update",
    "Not yet synced": "Not yet synced",
    "Dismiss": "Dismiss",

    // ── Monitoring ──
    "Waiting for first fleet sync…": "Waiting for first fleet sync…",
    "Search and filter every truck in the fleet, dispatched or not": "Search and filter every truck in the fleet, dispatched or not",
    "Search driver or truck ID…": "Search driver or truck ID…",
    "all": "all",
    "dispatched": "dispatched",
    "moving": "moving",
    "idle": "idle",
    "offline": "offline",
    "off-route": "off-route",
    "Truck": "Truck",
    "Driver": "Driver",
    "Status": "Status",
    "Speed": "Speed",
    "Updated": "Updated",
    "Destination": "Destination",
    "No trucks match.": "No trucks match.",
    "Staff car — excluded from notifications": "Staff car — excluded from notifications",
    "staff": "staff",
    "Check": "Check",
    "Locate": "Locate",

    // ── Déchargés panel ──
    "{min} min or more at the client, then {settle} min since leaving, and not yet back at the plant or the parc.": "{min} min or more at the client, then {settle} min since leaving, and not yet back at the plant or the parc.",
    "Loading…": "Loading…",
    "No truck has finished unloading in the last {hours} hours.": "No truck has finished unloading in the last {hours} hours.",
    "free {age} · {duration} on site": "free {age} · {duration} on site",
    "admin.subtitle": "Geofence management, user accounts, and connection settings.",
  },
  fr: {
    "brand.title": "Suivi des itinéraires",
    "brand.subtitle": "OMD Transport · Ligne Amouda",
    "nav.dashboard": "Tableau de bord",
    "nav.dispatch": "Répartition",
    "nav.monitoring": "Surveillance",
    "nav.history": "Historique",
    "nav.reports": "Rapports",
    "nav.drivers": "Chauffeurs",
    "nav.carburant": "Carburant",
    "nav.notifications": "Notifications",
    "nav.admin": "Admin",
    "common.signOut": "Déconnexion",
    "common.language": "Langue",
    "dashboard.title": "Tableau de bord",
    "dashboard.subtitle": "Vue d'ensemble de l'état de la flotte",
    "dispatch.title": "Répartition",
    "dispatch.subtitle": "Assigner des camions aux destinations et vérifier le respect de l'itinéraire.",
    "monitoring.title": "Surveillance",
    "history.title": "Historique",
    "reports.title": "Rapport Parc",
    "reports.subtitle": "Camions entrés au PARC OMD.",
    "notifications.title": "Notifications",
    "admin.title": "Admin",

    // ── Sign in ──
    "OMD Fleet Operations": "Opérations de flotte OMD",
    "Email": "E-mail",
    "Password": "Mot de passe",
    "Hide password": "Masquer le mot de passe",
    "Show password": "Afficher le mot de passe",
    "Signing in…": "Connexion…",
    "Sign in": "Se connecter",
    "No account?": "Pas de compte ?",
    "Request an invite": "Demander un accès",
    "Please enter both email and password.": "Veuillez saisir votre adresse e-mail et votre mot de passe.",
    "Please enter a valid email address.": "Veuillez saisir une adresse e-mail valide.",
    "Invalid login credentials": "Identifiants incorrects",
    "Email not confirmed": "Adresse e-mail non confirmée",
    "User not found": "Utilisateur introuvable",
    "Email rate limit exceeded": "Trop de tentatives. Réessayez plus tard.",

    // ── App shell ──
    "go to dashboard": "aller au tableau de bord",
    "Active:": "Actifs :",
    "Live tracking active": "Suivi en direct actif",
    "Live tracking paused": "Suivi en direct en pause",
    "Live tracking error": "Erreur de suivi en direct",
    "Operational status": "État opérationnel",
    "Active runs": "Courses actives",
    "Off route": "Hors itinéraire",
    "Last update": "Dernière mise à jour",
    "Not yet synced": "Pas encore synchronisé",
    "Dismiss": "Fermer",

    // ── Monitoring ──
    "Waiting for first fleet sync…": "En attente de la première synchronisation de la flotte…",
    "Search and filter every truck in the fleet, dispatched or not": "Rechercher et filtrer tous les camions de la flotte, en mission ou non",
    "Search driver or truck ID…": "Rechercher un chauffeur ou un n° de camion…",
    "all": "tous",
    "dispatched": "en mission",
    "moving": "en marche",
    "idle": "à l'arrêt",
    "offline": "hors ligne",
    "off-route": "hors itinéraire",
    "Truck": "Camion",
    "Driver": "Chauffeur",
    "Status": "Statut",
    "Speed": "Vitesse",
    "Updated": "Actualisé",
    "Destination": "Destination",
    "No trucks match.": "Aucun camion ne correspond.",
    "Staff car — excluded from notifications": "Véhicule de service — exclu des notifications",
    "staff": "service",
    "Check": "Vérifier",
    "Locate": "Localiser",

    // ── Déchargés panel ──
    "{min} min or more at the client, then {settle} min since leaving, and not yet back at the plant or the parc.": "{min} min ou plus chez le client, puis {settle} min depuis le départ, et pas encore de retour à l'usine ou au parc.",
    "Loading…": "Chargement…",
    "No truck has finished unloading in the last {hours} hours.": "Aucun camion n'a fini de décharger au cours des {hours} dernières heures.",
    "free {age} · {duration} on site": "libre {age} · {duration} sur place",
    "admin.subtitle": "Gestion des géorepérages, comptes utilisateurs et paramètres de connexion.",
  },
  ar: {
    "brand.title": "مراقبة مسارات الأسطول",
    "brand.subtitle": "OMD للنقل · خط أموداء",
    "nav.dashboard": "لوحة التحكم",
    "nav.dispatch": "الإرسال",
    "nav.monitoring": "المراقبة",
    "nav.history": "السجل",
    "nav.reports": "التقارير",
    "nav.drivers": "السائقون",
    "nav.carburant": "الوقود",
    "nav.notifications": "الإشعارات",
    "nav.admin": "الإدارة",
    "common.signOut": "تسجيل الخروج",
    "common.language": "اللغة",
    "dashboard.title": "لوحة التحكم",
    "dashboard.subtitle": "نظرة عامة على حالة الأسطول",
    "dispatch.title": "الإرسال",
    "dispatch.subtitle": "تعيين الشاحنات للوجهات والتحقق من الالتزام بالمسار.",
    "monitoring.title": "المراقبة",
    "history.title": "السجل",
    "reports.title": "تقرير الحظيرة",
    "reports.subtitle": "الشاحنات التي دخلت حظيرة OMD.",
    "notifications.title": "الإشعارات",
    "admin.title": "الإدارة",
    "admin.subtitle": "إدارة الجيوفنس وحسابات المستخدمين وإعدادات الاتصال.",
  },
};

/**
 * Look up a key, and fill any {placeholders} in the result.
 *
 * Interpolation matters more than it looks. Without it a sentence with a
 * number in it has to be translated as fragments — "min or more at the
 * client, then" — and French does not keep English's word order, so the
 * fragments end up in the wrong places or read like a telegram. One key
 * holding the whole sentence lets the translation move the number to
 * wherever French wants it.
 *
 * An unknown placeholder is left alone rather than blanked: seeing
 * "{hours} hours" on screen says which name is wrong, where an empty gap
 * says only that something is.
 */
export function translate(
  lang: Language,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const text = translations[lang]?.[key] ?? translations.en[key] ?? key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}
