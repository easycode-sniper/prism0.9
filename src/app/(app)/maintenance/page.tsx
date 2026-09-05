"use client";

import { Droplets, Disc } from "lucide-react";
import { useTranslation } from "@/lib/i18n/I18nProvider";

/**
 * Maintenance & Service.
 *
 * Deliberately a placeholder, and deliberately a specific one. The
 * measurement half of service intervals is already solved — distance per
 * truck per day is in fleet_day_metrics, and every fuel fill carries a real
 * odometer reading — so the only thing standing between this page and
 * working reminders is a starting point per truck: when each one last had
 * its oil changed, and when its current tyres went on. Nobody knows that
 * yet, which is why the sections say what they need rather than showing an
 * empty table that looks broken.
 *
 * Coming-soon status is chrome, so it stays achromatic. Amber would read as
 * "idle" and red as "off-route" — the five hues in this system are spoken
 * for by vehicle state, and a section that is merely unbuilt is not a truck
 * telling us something.
 */
export default function MaintenancePage() {
  const { t } = useTranslation();

  return (
    <div className="mnt-page">
      <header className="mnt-head">
        <h2 className="mnt-title">{t("Maintenance & Service")}</h2>
        <p className="mnt-sub">{t("Service intervals per truck, from the distance Prism already measures.")}</p>
      </header>

      <div className="mnt-grid">
        <SoonCard
          icon={<Droplets size={16} strokeWidth={2} aria-hidden="true" />}
          title={t("Oil change & filters")}
          blurb={t("Will show which trucks are due or overdue for an oil change, and by how many kilometres.")}
          need={t("One starting point per truck: the date and odometer of its last oil change.")}
          t={t}
        />
        <SoonCard
          icon={<Disc size={16} strokeWidth={2} aria-hidden="true" />}
          title={t("Tyres")}
          blurb={t("Will show tyre age and distance since fitting, and flag sets due for replacement.")}
          need={t("One starting point per truck: the date and odometer when its current tyres were fitted.")}
          t={t}
        />
      </div>

      <p className="mnt-foot">
        {t("Prism already measures the distance each truck covers, so nothing else has to be entered by hand — only the starting point is missing.")}
      </p>
    </div>
  );
}

function SoonCard({
  icon,
  title,
  blurb,
  need,
  t,
}: {
  icon: React.ReactNode;
  title: string;
  blurb: string;
  need: string;
  t: (key: string) => string;
}) {
  return (
    <section className="panel mnt-card">
      <div className="mnt-card__head">
        <span className="mnt-card__icon">{icon}</span>
        <h3 className="mnt-card__title">{title}</h3>
        <span className="mnt-card__soon">{t("Coming soon")}</span>
      </div>

      <p className="mnt-card__blurb">{blurb}</p>

      <div className="mnt-card__need">
        <span className="mnt-card__need-label">{t("What's needed to switch it on")}</span>
        <p className="mnt-card__need-text">{need}</p>
      </div>
    </section>
  );
}
