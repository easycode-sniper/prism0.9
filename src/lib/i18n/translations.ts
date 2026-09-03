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
  // Units and words French spells the same way.
  "Litres",
  "L/100km",
  "Distance",
  "{from} → {to}",
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

    // ── Notification text (rendered from stored English) ──
    "Arrived at the factory": "Arrived at the factory",
    "Arrived at factory": "Arrived at factory",
    "Arrived at headquarters": "Arrived at headquarters",
    "Arrived at destination": "Arrived at destination",
    "Arriving at client shortly": "Arriving at client shortly",
    "Truck left assigned route": "Truck left assigned route",
    "Speed limit exceeded": "Speed limit exceeded",
    "Stopped at a blacklisted station": "Stopped at a blacklisted station",
    "TEST — Truck reached the factory": "TEST — Truck reached the factory",
    "TEST — Arriving at client shortly": "TEST — Arriving at client shortly",
    "Alert": "Alert",
    "{truck} has arrived at {place}.": "{truck} has arrived at {place}.",
    "{truck} has stopped at {place}.": "{truck} has stopped at {place}.",
    "{truck} has deviated from its route to {site} ({km}km off).": "{truck} has deviated from its route to {site} ({km}km off).",
    "{truck} is about {duration} from {site}.": "{truck} is about {duration} from {site}.",
    "{truck} is going {speed}km/h (limit {limit}km/h).": "{truck} is going {speed}km/h (limit {limit}km/h).",
    "TEST ALERT (not a real run): this is the factory arrival alert, the cue to dispatch a truck.": "TEST ALERT (not a real run): this is the factory arrival alert, the cue to dispatch a truck.",
    "TEST ALERT (not a real run): this is the client 5-minute alert, which was rejected by the database until now.": "TEST ALERT (not a real run): this is the client 5-minute alert, which was rejected by the database until now.",

    // ── Notification text — historical wording ──
    "{truck} is going {speed}km/h on the run to {site} (limit {limit}km/h).": "{truck} is going {speed}km/h on the run to {site} (limit {limit}km/h).",

    // ── Dashboard ──
    "Today": "Today",
    "Yesterday": "Yesterday",
    "7 days": "7 days",
    "30 days": "30 days",
    "This month": "This month",
    "Last month": "Last month",
    "All time": "All time",
    "all time": "all time",
    "the start": "the start",
    "now": "now",
    "{from} → {to}": "{from} → {to}",
    "From": "From",
    "To": "To",
    "Operations days, {tz}": "Operations days, {tz}",
    " · {n} with data": " · {n} with data",
    "Every figure below covers {range}": "Every figure below covers {range}",
    ", first to last fill {period}": ", first to last fill {period}",
    "The figures below could not be loaded: {reason}": "The figures below could not be loaded: {reason}",
    "Kilometres driven": "Kilometres driven",
    "{n} fills": "{n} fills",
    "Litres consumed": "Litres consumed",
    "incl. {n} L with no km logged": "incl. {n} L with no km logged",
    "Amount filled": "Amount filled",
    "{n} fills logged amount only": "{n} fills logged amount only",
    "paid at the pump": "paid at the pump",
    "Average consumption": "Average consumption",
    "{n} fills with km logged": "{n} fills with km logged",
    "Total variance": "Total variance",
    "▲ over the assumed rate": "▲ over the assumed rate",
    "▼ under the assumed rate": "▼ under the assumed rate",
    "Distance per day": "Distance per day",
    "Fleet kilometres, staff cars included.": "Fleet kilometres, staff cars included.",
    "Today is still counting.": "Today is still counting.",
    "No fleet tracking before {day} — those days are a gap, not zero.": "No fleet tracking before {day} — those days are a gap, not zero.",
    "What fuel cost per day": "What fuel cost per day",
    "Bars are what was paid at the pump, every fill. The line is the montant kilométrique — dinars per kilometre, on the fills that logged a distance.": "Bars are what was paid at the pump, every fill. The line is the montant kilométrique — dinars per kilometre, on the fills that logged a distance.",
    "Today fills in as the sheet syncs.": "Today fills in as the sheet syncs.",
    "Litres bought per day": "Litres bought per day",
    "Consumption per day": "Consumption per day",
    "L/100km, on fills that logged a distance. The sheet assumes 45.": "L/100km, on fills that logged a distance. The sheet assumes 45.",
    "Alerts raised per day": "Alerts raised per day",
    "Off route, speeding and arrivals together.": "Off route, speeding and arrivals together.",
    "Loading chart": "Loading chart",
    "Litres": "Litres",
    "L/100km": "L/100km",
    "Cost per km": "Cost per km",
    "Fuel variance by truck": "Fuel variance by truck",
    "The same écart, per vehicle. A truck that is thirsty under several drivers is a truck, not a run of unlucky people.": "The same écart, per vehicle. A truck that is thirsty under several drivers is a truck, not a run of unlucky people.",
    "Fuel variance by driver": "Fuel variance by driver",
    "No fill carries a variance yet.": "No fill carries a variance yet.",
    " — worst first": " — worst first",
    " — best first": " — best first",
    "Drivers": "Drivers",
    "Distance": "Distance",
    "Variance": "Variance",
    "What the fleet is doing": "What the fleet is doing",
    "live": "live",
    "Reads the live fleet — the date range does not apply": "Reads the live fleet — the date range does not apply",
    "Moving": "Moving",
    "Stationary": "Stationary",
    "Offline": "Offline",
    "Waiting for the first fleet snapshot.": "Waiting for the first fleet snapshot.",
    "Drivers on duty": "Drivers on duty",
    "Who is out right now.": "Who is out right now.",
    "No driver is named on the current fleet feed.": "No driver is named on the current fleet feed.",
    "on a run": "on a run",
    "Trucks on their way to a client right now.": "Trucks on their way to a client right now.",
    "On route": "On route",
    "ETA {eta}": "ETA {eta}",
    "no ETA yet": "no ETA yet",
    "Operational signals": "Operational signals",
    "The latest from the alert feed.": "The latest from the alert feed.",
    "Over the limit, by driver": "Over the limit, by driver",
    "Times above {limit} km/h this month, anywhere in the fleet.": "Times above {limit} km/h this month, anywhere in the fleet.",
    "Nobody has crossed {limit} km/h this month.": "Nobody has crossed {limit} km/h this month.",
    "{n} trucks": "{n} trucks",
    "{crossings} crossing of the limit by {drivers} driver. Slowing down and speeding up again counts twice.": "{crossings} crossing of the limit by {drivers} driver. Slowing down and speeding up again counts twice.",
    "{crossings} crossings of the limit by {drivers} drivers. Slowing down and speeding up again counts twice.": "{crossings} crossings of the limit by {drivers} drivers. Slowing down and speeding up again counts twice.",
    "just now": "just now",
    "{n} min ago": "{n} min ago",
    "{n} hr ago": "{n} hr ago",
    "{n} d ago": "{n} d ago",
    "unavailable": "unavailable",
    "reading the sheet…": "reading the sheet…",
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

    // ── Notification text (rendered from stored English) ──
    "Arrived at the factory": "Arrivé à l'usine",
    "Arrived at factory": "Arrivé à l'usine",
    "Arrived at headquarters": "Arrivé au parc",
    "Arrived at destination": "Arrivé à destination",
    "Arriving at client shortly": "Arrivée imminente chez le client",
    "Truck left assigned route": "Camion sorti de son itinéraire",
    "Speed limit exceeded": "Excès de vitesse",
    "Stopped at a blacklisted station": "Arrêt dans une station interdite",
    "TEST — Truck reached the factory": "TEST — Camion arrivé à l'usine",
    "TEST — Arriving at client shortly": "TEST — Arrivée imminente chez le client",
    "Alert": "Alerte",
    "{truck} has arrived at {place}.": "{truck} est arrivé à {place}.",
    "{truck} has stopped at {place}.": "{truck} s'est arrêté à {place}.",
    "{truck} has deviated from its route to {site} ({km}km off).": "{truck} a quitté son itinéraire vers {site} ({km} km d'écart).",
    "{truck} is about {duration} from {site}.": "{truck} est à environ {duration} de {site}.",
    "{truck} is going {speed}km/h (limit {limit}km/h).": "{truck} roule à {speed} km/h (limite {limit} km/h).",
    "TEST ALERT (not a real run): this is the factory arrival alert, the cue to dispatch a truck.": "ALERTE DE TEST (course fictive) : ceci est l'alerte d'arrivée à l'usine, le signal pour envoyer un camion.",
    "TEST ALERT (not a real run): this is the client 5-minute alert, which was rejected by the database until now.": "ALERTE DE TEST (course fictive) : ceci est l'alerte client à 5 minutes, que la base de données refusait jusqu'ici.",

    // ── Notification text — historical wording ──
    "{truck} is going {speed}km/h on the run to {site} (limit {limit}km/h).": "{truck} roule à {speed} km/h sur le trajet vers {site} (limite {limit} km/h).",

    // ── Dashboard ──
    "Today": "Aujourd'hui",
    "Yesterday": "Hier",
    "7 days": "7 jours",
    "30 days": "30 jours",
    "This month": "Ce mois-ci",
    "Last month": "Le mois dernier",
    "All time": "Depuis le début",
    "all time": "depuis le début",
    "the start": "le début",
    "now": "maintenant",
    "{from} → {to}": "{from} → {to}",
    "From": "Du",
    "To": "Au",
    "Operations days, {tz}": "Jours d'exploitation, {tz}",
    " · {n} with data": " · {n} avec données",
    "Every figure below covers {range}": "Tous les chiffres ci-dessous couvrent {range}",
    ", first to last fill {period}": ", du premier au dernier plein {period}",
    "The figures below could not be loaded: {reason}": "Impossible de charger les chiffres ci-dessous : {reason}",
    "Kilometres driven": "Kilomètres parcourus",
    "{n} fills": "{n} pleins",
    "Litres consumed": "Litres consommés",
    "incl. {n} L with no km logged": "dont {n} L sans km enregistrés",
    "Amount filled": "Montant des pleins",
    "{n} fills logged amount only": "{n} pleins avec le montant seul",
    "paid at the pump": "payé à la pompe",
    "Average consumption": "Consommation moyenne",
    "{n} fills with km logged": "{n} pleins avec km enregistrés",
    "Total variance": "Écart total",
    "▲ over the assumed rate": "▲ au-dessus du taux de référence",
    "▼ under the assumed rate": "▼ en dessous du taux de référence",
    "Distance per day": "Distance par jour",
    "Fleet kilometres, staff cars included.": "Kilomètres de la flotte, véhicules de service inclus.",
    "Today is still counting.": "La journée est encore en cours.",
    "No fleet tracking before {day} — those days are a gap, not zero.": "Aucun suivi de flotte avant le {day} — ces jours sont une absence de données, pas un zéro.",
    "What fuel cost per day": "Coût du carburant par jour",
    "Bars are what was paid at the pump, every fill. The line is the montant kilométrique — dinars per kilometre, on the fills that logged a distance.": "Les barres correspondent au montant payé à la pompe, chaque plein. La courbe est le montant kilométrique — dinars par kilomètre, sur les pleins avec une distance enregistrée.",
    "Today fills in as the sheet syncs.": "La journée se complète au fil de la synchronisation du fichier.",
    "Litres bought per day": "Litres achetés par jour",
    "Consumption per day": "Consommation par jour",
    "L/100km, on fills that logged a distance. The sheet assumes 45.": "L/100km, sur les pleins avec une distance enregistrée. Le fichier suppose 45.",
    "Alerts raised per day": "Alertes déclenchées par jour",
    "Off route, speeding and arrivals together.": "Hors itinéraire, excès de vitesse et arrivées confondus.",
    "Loading chart": "Chargement du graphique",
    "Litres": "Litres",
    "L/100km": "L/100km",
    "Cost per km": "Coût par km",
    "Fuel variance by truck": "Écart carburant par camion",
    "The same écart, per vehicle. A truck that is thirsty under several drivers is a truck, not a run of unlucky people.": "Le même écart, par véhicule. Un camion gourmand avec plusieurs chauffeurs est un problème de camion, pas une série de malchances.",
    "Fuel variance by driver": "Écart carburant par chauffeur",
    "No fill carries a variance yet.": "Aucun plein ne présente encore d'écart.",
    " — worst first": " — les pires en premier",
    " — best first": " — les meilleurs en premier",
    "Drivers": "Chauffeurs",
    "Distance": "Distance",
    "Variance": "Écart",
    "What the fleet is doing": "Ce que fait la flotte",
    "live": "en direct",
    "Reads the live fleet — the date range does not apply": "Lit la flotte en direct — la période ne s'applique pas",
    "Moving": "En marche",
    "Stationary": "À l'arrêt",
    "Offline": "Hors ligne",
    "Waiting for the first fleet snapshot.": "En attente du premier relevé de la flotte.",
    "Drivers on duty": "Chauffeurs en service",
    "Who is out right now.": "Qui est sorti en ce moment.",
    "No driver is named on the current fleet feed.": "Aucun chauffeur n'est nommé dans le flux actuel de la flotte.",
    "on a run": "en mission",
    "Trucks on their way to a client right now.": "Camions en route vers un client en ce moment.",
    "On route": "Sur l'itinéraire",
    "ETA {eta}": "Arrivée dans {eta}",
    "no ETA yet": "pas encore d'estimation",
    "Operational signals": "Signaux d'exploitation",
    "The latest from the alert feed.": "Les dernières alertes du flux.",
    "Over the limit, by driver": "Dépassements, par chauffeur",
    "Times above {limit} km/h this month, anywhere in the fleet.": "Dépassements de {limit} km/h ce mois-ci, partout dans la flotte.",
    "Nobody has crossed {limit} km/h this month.": "Personne n'a dépassé {limit} km/h ce mois-ci.",
    "{n} trucks": "{n} camions",
    "{crossings} crossing of the limit by {drivers} driver. Slowing down and speeding up again counts twice.": "{crossings} dépassement de la limite par {drivers} chauffeur. Ralentir puis réaccélérer compte deux fois.",
    "{crossings} crossings of the limit by {drivers} drivers. Slowing down and speeding up again counts twice.": "{crossings} dépassements de la limite par {drivers} chauffeurs. Ralentir puis réaccélérer compte deux fois.",
    "just now": "à l'instant",
    "{n} min ago": "il y a {n} min",
    "{n} hr ago": "il y a {n} h",
    "{n} d ago": "il y a {n} j",
    "unavailable": "indisponible",
    "reading the sheet…": "lecture du fichier…",
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
